"""
collectors/username_checker.py – Async username presence checker.

Algorithm
---------
1. Load ``data/sites.json`` relative to the project root.
2. For each site, substitute the username into ``uri_check``.
3. Async-GET the URL (with a random User-Agent).
4. Determine existence by comparing HTTP status code to ``e_code`` (the code
   returned when the user does NOT exist) and/or checking for the absence of
   ``m_string`` in the response body.
5. Confidence scoring:
   - 0.95 when both the status code check AND the body string check pass.
   - 0.70 when only one of the two checks passes.
6. Rate-limit via ``asyncio.Semaphore`` (max 20 concurrent requests) and a
   small random inter-request delay.

Existence logic
---------------
Because sites return their "not found" state differently, the logic is:
  - If the response status code does NOT equal ``e_code``  → status says "found".
  - If ``m_string`` is non-null AND it does NOT appear in the body → body says "found".
  - The user is considered to exist when at least one check says "found".
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from typing import Any, Dict, List, Optional

import httpx

from app.collectors.base import BaseCollector, _get_user_agent
from app.config import settings
from app.models import EntityResult

logger = logging.getLogger(__name__)

# Path to the bundled sites database.
_SITES_JSON = os.path.join(
    os.path.dirname(__file__),  # …/app/collectors/
    "..",                        # …/app/
    "..",                        # …/backend/
    "data",
    "sites.json",
)
_SITES_JSON = os.path.normpath(_SITES_JSON)

# Limit concurrent outbound requests.
_CONCURRENCY = 20


def _load_sites() -> List[Dict[str, Any]]:
    """Load and return the list of site definitions from ``sites.json``."""
    try:
        with open(_SITES_JSON, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        sites = data.get("sites", [])
        logger.info("Loaded %d sites from %s", len(sites), _SITES_JSON)
        return sites
    except FileNotFoundError:
        logger.error("sites.json not found at %s", _SITES_JSON)
        return []
    except json.JSONDecodeError as exc:
        logger.error("sites.json is malformed: %s", exc)
        return []


import urllib.parse
import re

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
    """DDG HTML mode sometimes wraps URLs in //duckduckgo.com/l/?uddg=…"""
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

class UsernameChecker(BaseCollector):
    """Check whether a username is registered on a large set of websites using a hybrid DDG and direct HTTP pipeline."""

    def __init__(self) -> None:
        super().__init__()
        self._sites = _load_sites()

    async def _get_ddg_profiles(self, client: httpx.AsyncClient, username: str, site_filter: str = "") -> set:
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
                # Only keep links that contain the username (case-insensitive)
                filtered = set()
                username_lower = username.lower()
                for link in unwrapped:
                    if "duckduckgo.com" not in link and ("http://" in link or "https://" in link):
                        if username_lower in link.lower():
                            filtered.add(link)
                return filtered
        except Exception as exc:
            logger.debug("DuckDuckGo profile pre-fetch failed: %s", exc)
        return set()

    async def collect(self, query: str) -> List[EntityResult]:
        """Check query (the username) across all sites concurrently.

        Returns both Username and Website entities for every site where the
        username appears to be registered.
        """
        username = query.strip().lstrip("@")
        if not username:
            return []

        results: List[EntityResult] = []
        semaphore = asyncio.Semaphore(_CONCURRENCY)

        async with self._build_client() as client:
            # Step 1: Pre-fetch general DuckDuckGo profiles for the username to find major accounts
            ddg_profiles = await self._get_ddg_profiles(client, username, "profile")
            
            tasks = [
                self._check_site_hybrid(client, semaphore, username, site, ddg_profiles)
                for site in self._sites
            ]
            checked = await asyncio.gather(*tasks, return_exceptions=True)

        for item in checked:
            if isinstance(item, list):
                results.extend(item)
            elif isinstance(item, Exception):
                logger.debug("Username check task raised: %s", item)

        logger.info(
            "Username '%s': found %d profile entities",
            username,
            len(results) // 2,
        )
        return results

    async def _check_site_hybrid(
        self,
        client: httpx.AsyncClient,
        semaphore: asyncio.Semaphore,
        username: str,
        site: Dict[str, Any],
        ddg_profiles: set,
    ) -> List[EntityResult]:
        """Check a single site for the username using pre-fetched DDG profiles, fallback search, or direct HTTP check."""
        site_name: str = site.get("name", "Unknown")
        site_name_lower = site_name.lower()
        pretty_url = site.get("uri_pretty", "").replace("{}", username)
        
        bio = ""
        avatar_url = ""
        followers = ""
        following = ""
        posts = ""
        display_name = ""

        # Check if this is a protected social network
        is_protected = False
        for key, domains in PROTECTED_NETWORKS.items():
            if key in site_name_lower:
                is_protected = True
                break

        # A. Check pre-fetched DDG profiles
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

        # Direct fallback checks for key social networks
        if not found and is_protected:
            if site_name_lower == "instagram":
                try:
                    imginn_url = f"https://imginn.com/{username}/"
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                    response = await client.get(imginn_url, headers=headers)
                    if response.status_code == 200 and username.lower() in response.text.lower():
                        found = True
                        pretty_url = f"https://www.instagram.com/{username}/"
                        # Parse avatar, bio, stats
                        avatar_match = re.search(r'"image":\s*"([^"]+)"', response.text)
                        if avatar_match:
                            avatar_url = avatar_match.group(1)
                        desc_match = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', response.text, re.I)
                        if desc_match:
                            desc = desc_match.group(1)
                            stats_match = re.search(r'(.*?)\s*(\d+|undefined)\s+Followers,\s*(\d+|undefined)\s+Following,\s*(\d+|undefined)\s+Posts', desc, re.I)
                            if stats_match:
                                bio = stats_match.group(1).strip()
                                followers = stats_match.group(2).strip()
                                following = stats_match.group(3).strip()
                                posts = stats_match.group(4).strip()
                            else:
                                bio = desc
                except Exception:
                    pass
            elif site_name_lower == "reddit":
                try:
                    old_reddit_url = f"https://old.reddit.com/user/{username}/"
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                    response = await client.get(old_reddit_url, headers=headers)
                    if response.status_code == 200 and username.lower() in response.text.lower():
                        found = True
                        pretty_url = f"https://www.reddit.com/user/{username}/"
                except Exception:
                    pass
            elif site_name_lower in ("twitter", "x"):
                try:
                    x_url = f"https://x.com/{username}"
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                    response = await client.get(x_url, headers=headers)
                    if response.status_code == 200:
                        title_match = re.search(r'<title>(.*?)</title>', response.text, re.I)
                        title = title_match.group(1) if title_match else ""
                        if username.lower() in title.lower():
                            found = True
                            pretty_url = f"https://x.com/{username}"
                            # Parse avatar and display name
                            avatar_match = re.search(r'<meta[^>]+(?:property|name)="og:image"[^>]+content="([^"]+)"', response.text, re.I)
                            if not avatar_match:
                                avatar_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:image"', response.text, re.I)
                            if avatar_match:
                                avatar_url = avatar_match.group(1)
                            display_match = re.search(r'<meta[^>]+(?:property|name)="og:title"[^>]+content="([^"]+)"', response.text, re.I)
                            if not display_match:
                                display_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:title"', response.text, re.I)
                            if display_match:
                                display_name = display_match.group(1).split("(@")[0].strip()
                except Exception:
                    pass

        # B. Fallback: Query DDG specifically for protected networks if not in pre-fetch and not yet found
        if not found and is_protected:
            # Delay slightly to respect rate limits
            await asyncio.sleep(settings.username_check_delay + 0.1)
            specific_profiles = await self._get_ddg_profiles(client, username, site_name)
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

        # C. Direct HTTP GET check for standard sites
        if not found and not is_protected:
            async with semaphore:
                delay = settings.username_check_delay + random.uniform(0.0, 0.15)
                await asyncio.sleep(delay)
                
                url = site.get("uri_check", "").replace("{}", username)
                e_code = site.get("e_code")
                m_string = site.get("m_string")
                
                if not url:
                    return []
                    
                try:
                    response = await client.get(url)
                    
                    # 1. Filter request failures and blocks
                    if response.status_code in (401, 403, 404, 429, 500, 502, 503, 504):
                        found = False
                    # 2. Filter anti-bot/verification challenge pages
                    elif is_antibot_challenge(response.text):
                        found = False
                    # 3. Require username to be present in HTML body
                    elif username.lower() not in response.text.lower():
                        found = False
                    else:
                        status_says_found = (e_code is None) or (response.status_code != e_code)
                        body_says_found = True
                        if m_string is not None:
                            body_says_found = m_string not in response.text
                            
                        # Check for redirect to login page
                        is_login_redirect = False
                        if response.history:
                            final_url = str(response.url).lower()
                            if any(term in final_url for term in ("login", "signin", "signup", "accounts")):
                                is_login_redirect = True
                                
                        found = status_says_found and body_says_found and not is_login_redirect
                except Exception:
                    found = False

        # D. Post-discovery enrichment for key protected networks
        if found:
            if site_name_lower == "instagram" and not avatar_url:
                try:
                    imginn_url = f"https://imginn.com/{username}/"
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                    response = await client.get(imginn_url, headers=headers)
                    if response.status_code == 200:
                        avatar_match = re.search(r'"image":\s*"([^"]+)"', response.text)
                        if avatar_match:
                            avatar_url = avatar_match.group(1)
                        desc_match = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', response.text, re.I)
                        if desc_match:
                            desc = desc_match.group(1)
                            stats_match = re.search(r'(.*?)\s*(\d+|undefined)\s+Followers,\s*(\d+|undefined)\s+Following,\s*(\d+|undefined)\s+Posts', desc, re.I)
                            if stats_match:
                                bio = stats_match.group(1).strip()
                                followers = stats_match.group(2).strip()
                                following = stats_match.group(3).strip()
                                posts = stats_match.group(4).strip()
                            else:
                                bio = desc
                except Exception:
                    pass
            elif site_name_lower in ("twitter", "x") and not avatar_url:
                try:
                    x_url = f"https://x.com/{username}"
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                    response = await client.get(x_url, headers=headers)
                    if response.status_code == 200:
                        avatar_match = re.search(r'<meta[^>]+(?:property|name)="og:image"[^>]+content="([^"]+)"', response.text, re.I)
                        if not avatar_match:
                            avatar_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:image"', response.text, re.I)
                        if avatar_match:
                            avatar_url = avatar_match.group(1)
                        display_match = re.search(r'<meta[^>]+(?:property|name)="og:title"[^>]+content="([^"]+)"', response.text, re.I)
                        if not display_match:
                            display_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:title"', response.text, re.I)
                        if display_match:
                            display_name = display_match.group(1).split("(@")[0].strip()
                except Exception:
                    pass

        if found:
            confidence = 0.95
            
            metadata = {
                "site_name": site_name,
                "category": site.get("category", "unknown"),
                "source": "username_checker",
            }
            if bio:
                metadata["bio"] = bio
            if avatar_url:
                metadata["avatar_url"] = avatar_url
            if followers:
                metadata["followers"] = followers
            if following:
                metadata["following"] = following
            if posts:
                metadata["posts"] = posts
            if display_name:
                metadata["display_name"] = display_name
            
            username_entity = EntityResult(
                entity_type="Username",
                value=username,
                platform=site_name,
                url=pretty_url,
                confidence=confidence,
                metadata=metadata,
                source="username_checker",
            )
            
            website_entity = EntityResult(
                entity_type="Website",
                value=pretty_url,
                platform=site_name,
                url=pretty_url,
                confidence=confidence,
                metadata=metadata,
                source="username_checker",
            )
            
            return [username_entity, website_entity]

        return []
