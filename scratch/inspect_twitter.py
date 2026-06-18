import httpx
import re

async def main():
    url = "https://x.com/TheOjasvi"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        r = await client.get(url, headers=headers)
        print("Status Code:", r.status_code)
        
        html = r.text
        with open("scratch/twitter_output.html", "w", encoding="utf-8") as f:
            f.write(html)
            
        print("File saved. Length:", len(html))
        
        # Find and print all meta tags
        meta_tags = re.findall(r'<meta\s+([^>]+)>', html, re.I)
        print(f"Found {len(meta_tags)} meta tags:")
        for tag in meta_tags:
            print("  Tag attributes:", tag.strip())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
