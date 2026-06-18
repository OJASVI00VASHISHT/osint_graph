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

async def test_instagram_directly(username: str) -> bool:
    imginn_url = f"https://imginn.com/{username}/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
        try:
            response = await client.get(imginn_url, headers=headers)
            print(f"Direct Instagram check via Imginn: Status={response.status_code}")
            if response.status_code == 200 and username.lower() in response.text.lower():
                return True
        except Exception as e:
            print(f"Error checking Imginn directly: {e}")
    return False

async def main():
    print("Testing real user:")
    found_real = await test_instagram_directly("hehe_ojasvi")
    print(f"Found real user? {found_real}")
    
    print("\nTesting fake user:")
    found_fake = await test_instagram_directly("this_user_does_not_exist_123456789_random")
    print(f"Found fake user? {found_fake}")

if __name__ == "__main__":
    asyncio.run(main())
