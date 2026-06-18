import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

import asyncio
from app.collectors.username_checker import UsernameChecker

async def check(username):
    checker = UsernameChecker()
    checker._sites = [s for s in checker._sites if s["name"].lower() == "instagram"]
    results = await checker.collect(username)
    print(f"Results for '{username}':")
    if not results:
        print("  Not found.")
    for r in results:
        print(f"  Found on {r.platform}: {r.url} (Confidence: {r.confidence})")
        print(f"  Metadata: {r.metadata}")

async def main():
    await check("hehe_ojasvi")
    await check("this_user_does_not_exist_123456789_random")

if __name__ == "__main__":
    asyncio.run(main())
