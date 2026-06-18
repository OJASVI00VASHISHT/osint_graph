import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

import asyncio
import re
from app.collectors.username_checker import UsernameChecker
from app.collectors.base import _get_user_agent

async def inspect(username):
    checker = UsernameChecker()
    test_sites = [s for s in checker._sites if s["name"].lower() in [
        "instagram", "github", "reddit", "twitter", "facebook", "pypi", "hackerrank"
    ]]
    
    async with checker._build_client() as client:
        for site in test_sites:
            url = site.get("uri_check", "").replace("{}", username)
            try:
                response = await client.get(url)
                title_match = re.search(r"<title>(.*?)</title>", response.text, re.I)
                title = title_match.group(1).strip() if title_match else "No Title"
                print(f"[{site['name']}] Status: {response.status_code} | Title: {title} | Final URL: {response.url}")
            except Exception as e:
                print(f"[{site['name']}] Error: {e}")

async def main():
    print("=== INSPECTING HEHE_OJASVI ===")
    await inspect("hehe_ojasvi")
    print("\n=== INSPECTING NON-EXISTENT ===")
    await inspect("this_user_does_not_exist_123456789_random")

if __name__ == "__main__":
    asyncio.run(main())
