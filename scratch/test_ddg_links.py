import httpx
import re
import urllib.parse

def unwrap_ddg_url(href):
    if "uddg=" in href:
        try:
            inner = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("uddg", [href])
            return urllib.parse.unquote(inner[0])
        except Exception:
            pass
    return href

client = httpx.Client(follow_redirects=True, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'})
html = client.get('https://html.duckduckgo.com/html/?q=hehe_ojasvi+profile').text

# Extract all result links
result_links = re.findall(r'href="([^"]+)"', html)
unwrapped = [unwrap_ddg_url(link) for link in result_links]

# Filter links that are external and related to the search
for link in unwrapped:
    if "duckduckgo.com" not in link and ("http://" in link or "https://" in link):
        print(link)
