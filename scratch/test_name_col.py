import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

import asyncio
from app.collectors.name_collector import NameCollector
from app.collectors.username_checker import UsernameChecker

async def test_name():
    print("=== TESTING NAME SEARCH FOR 'Ojasvi' ===")
    collector = NameCollector()
    results = await collector.collect("Ojasvi")
    
    print(f"NameCollector returned {len(results)} entities:")
    for r in results:
        print(f"\n  - Entity: {r.entity_type} | Value: {r.value} | Platform: {r.platform}")
        print(f"    URL: {r.url}")
        print(f"    Confidence: {r.confidence}")
        print(f"    Metadata: {r.metadata}")
        
    # Validations
    has_person = any(r.entity_type == "Person" and r.value == "Ojasvi" for r in results)
    has_only_allowed = all(
        r.entity_type == "Person" or r.platform in ("Instagram", "Twitter", "Facebook") 
        for r in results
    )
    print("\n--- VALIDATION RESULTS ---")
    print(f"Has central Person node? {has_person}")
    print(f"Has only Instagram/Twitter/Facebook results? {has_only_allowed}")

async def test_username():
    print("\n=== TESTING USERNAME CHECK FOR 'hehe_ojasvi' ===")
    checker = UsernameChecker()
    results = await checker.collect("hehe_ojasvi")
    
    print(f"UsernameChecker returned {len(results)} entities:")
    for r in results:
        print(f"\n  - Entity: {r.entity_type} | Value: {r.value} | Platform: {r.platform}")
        print(f"    URL: {r.url}")
        print(f"    Metadata: {r.metadata}")
        
    instagram_entity = next((r for r in results if r.platform == "Instagram"), None)
    if instagram_entity:
        meta = instagram_entity.metadata
        has_bio = "bio" in meta and len(meta["bio"]) > 0
        has_avatar = "avatar_url" in meta and len(meta["avatar_url"]) > 0
        has_followers = "followers" in meta and len(meta["followers"]) > 0
        print("\n--- VALIDATION RESULTS ---")
        print(f"Has Instagram bio? {has_bio} (value: {meta.get('bio')})")
        print(f"Has Instagram avatar? {has_avatar} (value: {meta.get('avatar_url')})")
        print(f"Has Instagram followers? {has_followers} (value: {meta.get('followers')})")
    else:
        print("\nInstagram profile not found in results!")

async def main():
    await test_name()
    await test_username()

if __name__ == "__main__":
    asyncio.run(main())
