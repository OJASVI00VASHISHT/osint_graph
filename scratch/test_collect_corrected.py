import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

import asyncio
import httpx
import urllib.parse
import re
from typing import List, Dict, Any, Optional
from app.models import EntityResult
from app.collectors.username_checker import _load_sites, _get_user_agent

# List of highly protected social networks where direct GET requests fail/block
PROTECTED_NETWORKS = {
    "instagram": ["instagram.com"],
    "facebook": ["facebook.com"],
    "reddit": ["reddit.com"],
    "twitter": ["twitter.com", "x.com"],
    "tiktok": ["tiktok.com"],
    "linkedin": ["linkedin.com"],
    "pinterest": ["pinterest.com", "pinterest.co.uk"],
}

def unwrap_ddg_url(href: str) -> str:
    if "uddg=" in href:
        try:
            inner = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("uddg", [href])
            return urllib.parse.unquote(inner[0])
        except Exception:
            pass
    return href

def is_antibot_challenge(text: str) -> bool:
    """Return True if the response HTML is an anti-bot challenge (Cloudflare, reCAPTCHA, etc.)."""
    text_lower = text.lower()
    indicators = [
        "recaptcha/challengepage",
        "recaptcha/api",
        "g-recaptcha",
        "hcaptcha",
        "cloudflare",
        "security check",
        "robot check",
        "distilnetworks",
        "perimeterx",
        "please enable javascript",
        "enable js",
        "captcha",
        "access denied",
        "client challenge",
        "please wait for verification",
        "please verify you are a human"
    ]
    return any(ind in text_lower for ind in indicators)

async def get_ddg_profiles(client: httpx.AsyncClient, username: str, site_filter: str = "") -> set:
    """Query DuckDuckGo for profiles of a username and return unwrapped URLs."""
    query = f"{username} {site_filter}".strip()
    url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote_plus(query)}"
    headers = {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    
    try:
        response = await client.get(url, headers=headers)
        if response.status_code == 200:
            html = response.text
            links = re.findall(r'href="([^"]+)"', html)
            unwrapped = {unwrap_ddg_url(link) for link in links}
            # Only keep links that contain the username (case-insensitive) and are not internal
            filtered = set()
            username_lower = username.lower()
            for link in unwrapped:
                if "duckduckgo.com" not in link and ("http://" in link or "https://" in link):
                    if username_lower in link.lower():
                        filtered.add(link)
            return filtered
    except Exception as e:
        print(f"Error querying DDG: {e}")
    return set()

async def check_site_direct(
    client: httpx.AsyncClient,
    username: str,
    site: Dict[str, Any]
) -> bool:
    """Perform direct HTTP check with corrected strict logic."""
    url = site.get("uri_check", "").replace("{}", username)
    e_code = site.get("e_code")
    m_string = site.get("m_string")
    
    try:
        response = await client.get(url)
        
        # 1. Check if the status code indicates failure
        if response.status_code in (401, 403, 404, 429, 500, 502, 503, 504):
            return False
            
        # 2. Check for anti-bot challenge page
        if is_antibot_challenge(response.text):
            return False
            
        # 3. Require the username to be present in the response body (case-insensitive)
        # E.g. a valid profile must reference the user somewhere in the HTML
        if username.lower() not in response.text.lower():
            return False
            
        # 4. Strict status check
        status_says_found = (e_code is None) or (response.status_code != e_code)
        
        # 5. Strict body check
        body_says_found = True
        if m_string is not None:
            body_says_found = m_string not in response.text
            
        # 6. Check for login redirect page
        is_login_redirect = False
        if response.history:
            final_url = str(response.url).lower()
            if any(term in final_url for term in ("login", "signin", "signup", "accounts")):
                is_login_redirect = True
                
        return status_says_found and body_says_found and not is_login_redirect
    except Exception:
        return False

async def collect_username(username: str) -> List[EntityResult]:
    username = username.strip()
    if not username:
        return []
        
    sites = _load_sites()
    results: List[EntityResult] = []
    
    async with httpx.AsyncClient(headers={"User-Agent": _get_user_agent()}, follow_redirects=True, timeout=10.0) as client:
        # Step 1: Pre-fetch general DuckDuckGo profiles for the username
        print(f"Pre-fetching DuckDuckGo profiles for '{username}'...")
        ddg_profiles = await get_ddg_profiles(client, username, "profile")
        print(f"Pre-fetched {len(ddg_profiles)} profiles: {ddg_profiles}")
        
        # Step 2: Iterate and check each site
        semaphore = asyncio.Semaphore(20)
        
        async def process_site(site):
            site_name = site.get("name", "Unknown")
            site_name_lower = site_name.lower()
            
            # Check if this is a protected social network
            is_protected = False
            for key, domains in PROTECTED_NETWORKS.items():
                if key in site_name_lower:
                    is_protected = True
                    break
                    
            pretty_url = site.get("uri_pretty", "").replace("{}", username)
            
            # Sub-check A: Was it found in our pre-fetched DDG profiles?
            found = False
            for profile_url in ddg_profiles:
                domain_match = False
                for key, domains in PROTECTED_NETWORKS.items():
                    if key in site_name_lower and any(d in profile_url.lower() for d in domains):
                        domain_match = True
                        break
                if not domain_match and site_name_lower in profile_url.lower():
                    domain_match = True
                    
                if domain_match:
                    found = True
                    pretty_url = profile_url
                    break
                    
            # Sub-check B: If protected but not found in pre-fetch, query DDG specifically for it
            if not found and is_protected:
                specific_profiles = await get_ddg_profiles(client, username, site_name)
                for profile_url in specific_profiles:
                    domain_match = False
                    for key, domains in PROTECTED_NETWORKS.items():
                        if key in site_name_lower and any(d in profile_url.lower() for d in domains):
                            domain_match = True
                            break
                    if domain_match:
                        found = True
                        pretty_url = profile_url
                        break
                        
            # Sub-check C: If not protected, run direct HTTP check
            if not found and not is_protected:
                async with semaphore:
                    await asyncio.sleep(0.05)
                    found = await check_site_direct(client, username, site)
                    
            if found:
                # Yield two entities: Username and Website
                username_entity = EntityResult(
                    entity_type="Username",
                    value=username,
                    platform=site_name,
                    url=pretty_url,
                    confidence=0.95,
                    metadata={"site_name": site_name, "category": site.get("category", "unknown")},
                    source="username_checker"
                )
                website_entity = EntityResult(
                    entity_type="Website",
                    value=pretty_url,
                    platform=site_name,
                    url=pretty_url,
                    confidence=0.95,
                    metadata={"site_name": site_name, "category": site.get("category", "unknown")},
                    source="username_checker"
                )
                return [username_entity, website_entity]
            return []

        tasks = [process_site(site) for site in sites]
        checked = await asyncio.gather(*tasks, return_exceptions=True)
        
        for item in checked:
            if isinstance(item, list):
                results.extend(item)
                
    return results

async def run_test():
    print("=== TESTING REAL USERNAME ===")
    results_real = await collect_username("hehe_ojasvi")
    print(f"Real user results: {len(results_real)} entities found.")
    for r in results_real:
        print(f"  Entity: {r.entity_type} | Platform: {r.platform} | Value: {r.value} | URL: {r.url}")
        
    print("\n=== TESTING NON-EXISTENT USERNAME ===")
    results_fake = await collect_username("this_user_does_not_exist_123456789_random")
    print(f"Fake user results: {len(results_fake)} entities found.")
    for r in results_fake:
        print(f"  Entity: {r.entity_type} | Platform: {r.platform} | Value: {r.value} | URL: {r.url}")

if __name__ == "__main__":
    asyncio.run(run_test())
