import httpx
import re

async def main():
    url = "https://imginn.com/hehe_ojasvi/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        r = await client.get(url, headers=headers)
        print("Status Code:", r.status_code)
        
        html = r.text
        with open("scratch/imginn_output.html", "w", encoding="utf-8") as f:
            f.write(html)
            
        print("File saved. Length:", len(html))
        
        # Title
        title_match = re.search(r"<title>(.*?)</title>", html, re.I)
        print("Title:", title_match.group(1).strip() if title_match else "None")
        
        # Let's inspect some of the classes
        print("Matching lines:")
        for line in html.splitlines():
            line_str = line.strip()
            if not line_str:
                continue
            # Look for stats like posts, followers, following
            if any(term in line_str.lower() for term in ("follower", "following", "post", "bio", "avatar", "profile-pic", "header")):
                if len(line_str) < 300:
                    print("  ", line_str)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
