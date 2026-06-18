"""
collectors/name_collector.py – Refined Name search to target Instagram, Twitter/X, and Facebook with case-insensitive matching, direct fallbacks, and profile picture/bio extraction.
"""

from __future__ import annotations

import asyncio
import logging
import re
import urllib.parse
from typing import List, Dict, Any

import httpx

from app.collectors.base import BaseCollector
from app.models import EntityResult

logger = logging.getLogger(__name__)

# Platforms to bias the search towards.
_SEARCH_SITES = "site:instagram.com OR site:twitter.com OR site:x.com OR site:facebook.com"

# Regex patterns for pulling anchor links/snippets out of raw DDG HTML.
_RESULT_URL_RE = re.compile(
    r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)
_SNIPPET_RE = re.compile(
    r'<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")


def _strip_tags(html: str) -> str:
    """Remove all HTML tags and decode basic entities."""
    text = _TAG_RE.sub(" ", html)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    return " ".join(text.split())


class NameCollector(BaseCollector):
    """Search DuckDuckGo for a person's name on key social networks and extract profiles with rich details."""

    async def collect(self, query: str) -> List[EntityResult]:
        name = query.strip()
        if not name:
            return []

        results: List[EntityResult] = []

        # Add the searched name itself as a central Person node to serve as a graph hub
        results.append(
            EntityResult(
                entity_type="Person",
                value=name,
                confidence=1.0,
                metadata={"query_name": name, "source": "name_collector"},
                source="name_collector",
            )
        )

        search_query = urllib.parse.quote_plus(f'{name} profile {_SEARCH_SITES}')
        url = f"https://html.duckduckgo.com/html/?q={search_query}"

        headers = {
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }

        async with self._build_client() as client:
            response = await self._get(client, url, extra_headers=headers)

        html = ""
        if response is not None and response.status_code == 200:
            html = response.text
        else:
            status_code = response.status_code if response else "None"
            logger.warning("DuckDuckGo search returned status %s for '%s'. Using direct check fallbacks.", status_code, name)

        # ── Parse and filter results from DDG search ──────────────────────
        exact_matches: List[Dict[str, Any]] = []
        extended_matches: List[Dict[str, Any]] = []

        clean_query = re.sub(r'[^a-zA-Z0-9]', '', name).lower()

        if html:
            for match in _RESULT_URL_RE.finditer(html):
                href = self._unwrap_ddg_url(match.group(1))
                title_html = match.group(2)
                title = _strip_tags(title_html)

                if not href or not href.startswith("http"):
                    continue

                href_lower = href.lower()
                platform = ""
                if "instagram.com" in href_lower:
                    platform = "Instagram"
                elif "twitter.com" in href_lower or "x.com" in href_lower:
                    platform = "Twitter"
                elif "facebook.com" in href_lower:
                    platform = "Facebook"
                else:
                    continue

                # Extract username/handle from URL path
                handle_match = re.search(r'(?:instagram\.com|twitter\.com|x\.com|facebook\.com)/([^/?#]+)', href, re.I)
                handle = handle_match.group(1) if handle_match else ""
                if not handle or handle.lower() in ("p", "developer", "terms", "privacy", "about", "explore", "sharer"):
                    continue

                # Clean title to get display name
                display_name = title
                suffixes = [
                    "• Instagram photos and videos",
                    "• Instagram",
                    "/ X",
                    "on X",
                    "on Twitter",
                    "/ Twitter",
                    "| Facebook",
                    "- Facebook"
                ]
                for suffix in suffixes:
                    if suffix in display_name:
                        display_name = display_name.split(suffix)[0]
                if f"(@{handle})" in display_name:
                    display_name = display_name.split(f"(@{handle})")[0]
                elif "(@" in display_name:
                    display_name = display_name.split("(@")[0]
                display_name = display_name.strip()

                clean_handle = re.sub(r'[^a-zA-Z0-9]', '', handle).lower()
                clean_display = re.sub(r'[^a-zA-Z0-9]', '', display_name).lower()

                match_data = {
                    "handle": handle,
                    "url": href,
                    "platform": platform,
                    "title": title,
                    "display_name": display_name,
                    "bio": "",
                    "avatar_url": "",
                    "followers": "",
                    "following": "",
                    "posts": ""
                }

                if clean_handle == clean_query or clean_display == clean_query:
                    exact_matches.append(match_data)
                elif clean_query in clean_handle or clean_query in clean_display:
                    extended_matches.append(match_data)

        # ── Run direct handle check fallbacks ──────────────────────────────
        candidate_handles = []
        name_no_spaces = name.replace(" ", "")
        if name_no_spaces:
            candidate_handles.append(name_no_spaces)
        name_with_underscores = name.replace(" ", "_")
        if name_with_underscores and name_with_underscores != name_no_spaces:
            candidate_handles.append(name_with_underscores)

        direct_checked_profiles: List[Dict[str, Any]] = []
        if candidate_handles:
            async with self._build_client() as client:
                direct_tasks = [
                    self._check_handle_direct(client, h)
                    for h in candidate_handles
                ]
                direct_results = await asyncio.gather(*direct_tasks, return_exceptions=True)
                for item in direct_results:
                    if isinstance(item, list):
                        direct_checked_profiles.extend(item)

        # Merge direct checked results into exact matches list if not duplicate
        seen_urls = {p["url"].lower() for p in exact_matches} | {p["url"].lower() for p in extended_matches}
        for dp in direct_checked_profiles:
            if dp["url"].lower() not in seen_urls:
                seen_urls.add(dp["url"].lower())
                exact_matches.append(dp)

        # Cap extended matches to top 2 overall
        limited_extended = extended_matches[:2]
        final_profiles = exact_matches + limited_extended

        # ── Concurrently scrape rich profile details for matched profiles if not already enriched ──
        profiles_to_enrich = [p for p in final_profiles if not p["avatar_url"] and p["platform"] != "Facebook"]
        if profiles_to_enrich:
            async with self._build_client() as client:
                tasks = [
                    self._enrich_profile(client, profile)
                    for profile in profiles_to_enrich
                ]
                await asyncio.gather(*tasks, return_exceptions=True)

        # ── Package results into EntityResult objects ──────────────────────
        for profile in final_profiles:
            is_exact = profile in exact_matches
            confidence = 0.95 if is_exact else 0.75

            metadata = {
                "site_name": profile["platform"],
                "title": profile["title"],
                "match_type": "exact" if is_exact else "extended",
                "display_name": profile["display_name"],
                "source": "name_collector",
            }
            if profile["bio"]:
                metadata["bio"] = profile["bio"]
            if profile["avatar_url"]:
                metadata["avatar_url"] = profile["avatar_url"]
            if profile["followers"]:
                metadata["followers"] = profile["followers"]
            if profile["following"]:
                metadata["following"] = profile["following"]
            if profile["posts"]:
                metadata["posts"] = profile["posts"]

            username_entity = EntityResult(
                entity_type="Username",
                value=profile["handle"],
                platform=profile["platform"],
                url=profile["url"],
                confidence=confidence,
                metadata=metadata,
                source="name_collector",
            )

            website_entity = EntityResult(
                entity_type="Website",
                value=profile["url"],
                platform=profile["platform"],
                url=profile["url"],
                confidence=confidence,
                metadata=metadata,
                source="name_collector",
            )

            results.extend([username_entity, website_entity])

        logger.info(
            "Name search for '%s': returning %d entities (%d profiles)",
            name,
            len(results),
            len(final_profiles),
        )
        return results

    async def _check_handle_direct(self, client: httpx.AsyncClient, handle: str) -> List[Dict[str, Any]]:
        """Verify directly if a handle exists on Instagram and Twitter/X."""
        found_profiles = []
        
        # 1. Check Instagram
        try:
            imginn_url = f"https://imginn.com/{handle}/"
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            response = await client.get(imginn_url, headers=headers)
            if response.status_code == 200 and handle.lower() in response.text.lower():
                avatar_url = ""
                avatar_match = re.search(r'"image":\s*"([^"]+)"', response.text)
                if avatar_match:
                    avatar_url = avatar_match.group(1)
                
                bio = ""
                followers = ""
                following = ""
                posts = ""
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
                        
                found_profiles.append({
                    "handle": handle,
                    "url": f"https://www.instagram.com/{handle}/",
                    "platform": "Instagram",
                    "title": f"{handle} on Instagram",
                    "display_name": handle,
                    "bio": bio,
                    "avatar_url": avatar_url,
                    "followers": followers,
                    "following": following,
                    "posts": posts
                })
        except Exception:
            pass
            
        # 2. Check Twitter/X
        try:
            x_url = f"https://x.com/{handle}"
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            response = await client.get(x_url, headers=headers)
            if response.status_code == 200:
                title_match = re.search(r'<title>(.*?)</title>', response.text, re.I)
                title = title_match.group(1) if title_match else ""
                if handle.lower() in title.lower():
                    avatar_url = ""
                    avatar_match = re.search(r'<meta[^>]+(?:property|name)="og:image"[^>]+content="([^"]+)"', response.text, re.I)
                    if not avatar_match:
                        avatar_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:image"', response.text, re.I)
                    if avatar_match:
                        avatar_url = avatar_match.group(1)
                        
                    display_name = handle
                    display_match = re.search(r'<meta[^>]+(?:property|name)="og:title"[^>]+content="([^"]+)"', response.text, re.I)
                    if not display_match:
                        display_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:title"', response.text, re.I)
                    if display_match:
                        display_name = display_match.group(1).split("(@")[0].strip()
                        
                    found_profiles.append({
                        "handle": handle,
                        "url": f"https://x.com/{handle}",
                        "platform": "Twitter",
                        "title": title or f"{display_name} (@{handle}) / X",
                        "display_name": display_name,
                        "bio": "",
                        "avatar_url": avatar_url,
                        "followers": "",
                        "following": "",
                        "posts": ""
                    })
        except Exception:
            pass
            
        return found_profiles

    async def _enrich_profile(self, client: httpx.AsyncClient, profile: Dict[str, Any]) -> None:
        """Fetch profile page and extract avatar, bio, and statistics."""
        platform = profile["platform"].lower()
        username = profile["handle"]

        if platform == "instagram":
            try:
                imginn_url = f"https://imginn.com/{username}/"
                headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                response = await client.get(imginn_url, headers=headers)
                if response.status_code == 200:
                    avatar_match = re.search(r'"image":\s*"([^"]+)"', response.text)
                    if avatar_match:
                        profile["avatar_url"] = avatar_match.group(1)
                    desc_match = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', response.text, re.I)
                    if desc_match:
                        desc = desc_match.group(1)
                        stats_match = re.search(r'(.*?)\s*(\d+|undefined)\s+Followers,\s*(\d+|undefined)\s+Following,\s*(\d+|undefined)\s+Posts', desc, re.I)
                        if stats_match:
                            profile["bio"] = stats_match.group(1).strip()
                            profile["followers"] = stats_match.group(2).strip()
                            profile["following"] = stats_match.group(3).strip()
                            profile["posts"] = stats_match.group(4).strip()
                        else:
                            profile["bio"] = desc
            except Exception:
                pass
        elif platform == "twitter":
            try:
                x_url = f"https://x.com/{username}"
                headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                response = await client.get(x_url, headers=headers)
                if response.status_code == 200:
                    avatar_match = re.search(r'<meta[^>]+(?:property|name)="og:image"[^>]+content="([^"]+)"', response.text, re.I)
                    if not avatar_match:
                        avatar_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:image"', response.text, re.I)
                    if avatar_match:
                        profile["avatar_url"] = avatar_match.group(1)
                    
                    display_match = re.search(r'<meta[^>]+(?:property|name)="og:title"[^>]+content="([^"]+)"', response.text, re.I)
                    if not display_match:
                        display_match = re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:title"', response.text, re.I)
                    if display_match:
                        profile["display_name"] = display_match.group(1).split("(@")[0].strip()
            except Exception:
                pass

    @staticmethod
    def _unwrap_ddg_url(href: str) -> str:
        """DDG HTML mode sometimes wraps URLs in ``//duckduckgo.com/l/?uddg=…``."""
        if "uddg=" in href:
            try:
                inner = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("uddg", [href])
                return urllib.parse.unquote(inner[0])
            except Exception:
                pass
        return href
