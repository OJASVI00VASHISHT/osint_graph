import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

import asyncio
import httpx
from app.collectors.username_checker import UsernameChecker, _load_sites
from app.collectors.base import _get_user_agent
from app.config import settings

async def test_user(username):
    checker = UsernameChecker()
    # Let's run the check manually with the corrected logic
    found_sites = []
    
    async with httpx.AsyncClient(headers={"User-Agent": _get_user_agent()}, follow_redirects=True, timeout=5.0) as client:
        # To avoid taking too long, let's check a subset of sites including Instagram, GitHub, Reddit, TikTok, etc.
        test_sites = [s for s in checker._sites if s["name"].lower() in [
            "instagram", "github", "reddit", "twitter", "facebook", "gitlab", "npm", "pypi", "replit", "hackerrank"
        ]]
        
        for site in test_sites:
            url = site.get("uri_check", "").replace("{}", username)
            e_code = site.get("e_code")
            m_string = site.get("m_string")
            site_name = site.get("name")
            
            try:
                response = await client.get(url)
                
                # Corrected logic: BOTH must pass
                status_says_found = (e_code is None) or (response.status_code != e_code)
                
                body_says_found = True
                if m_string is not None:
                    body_says_found = m_string not in response.text
                
                # Check for redirect to login or generic home
                is_login_redirect = False
                if response.history:
                    final_url = str(response.url).lower()
                    if "login" in final_url or "signin" in final_url or "signup" in final_url:
                        is_login_redirect = True
                
                # Also check for standard client error/rate limit status codes
                if response.status_code in (401, 403, 429, 500, 502, 503, 504):
                    status_says_found = False
                
                is_found = status_says_found and body_says_found and not is_login_redirect
                
                if is_found:
                    found_sites.append((site_name, response.status_code))
            except Exception as exc:
                pass
                
    print(f"Results for '{username}': found on {len(found_sites)} sites: {found_sites}")

async def main():
    print("Testing with corrected logic...")
    await test_user("hehe_ojasvi")
    await test_user("this_user_does_not_exist_123456789_random")

if __name__ == "__main__":
    asyncio.run(main())
