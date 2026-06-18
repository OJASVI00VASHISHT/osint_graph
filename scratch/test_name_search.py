"""Quick test script for name search."""
import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.collectors.name_collector import NameCollector

async def main():
    nc = NameCollector()
    results = await nc.collect("ojasvi")
    print(f"Total results: {len(results)}")
    for r in results:
        platform = r.platform or "n/a"
        meta = r.metadata or {}
        avatar = "YES" if meta.get("avatar_url") else "no"
        bio = meta.get("bio", "")[:50] if meta.get("bio") else ""
        print(f"  {r.entity_type:10s} | {r.value:30s} | {platform:10s} | conf={r.confidence} | avatar={avatar} | bio={bio}")

if __name__ == "__main__":
    asyncio.run(main())
