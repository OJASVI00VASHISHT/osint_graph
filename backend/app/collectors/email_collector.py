"""
collectors/email_collector.py – Email address intelligence gathering.

Pipeline
--------
1. Validate the email format via regex.
2. Resolve MX records for the domain using ``dnspython``.
3a. If ``HIBP_API_KEY`` is configured: query the Have I Been Pwned v3 API.
3b. Otherwise: query the free ``emailrep.io`` API.
4. Return a single ``EntityResult`` with all gathered metadata.

Confidence heuristic
--------------------
- 1.0  → email appears in breach data (definitive confirmation it exists)
- 0.8  → MX records found and email has good reputation
- 0.5  → only format validation passed (no external confirmation)
"""

from __future__ import annotations

import logging
import re
from typing import List, Optional

import dns.resolver
import httpx

from app.collectors.base import BaseCollector
from app.config import settings
from app.models import EntityResult

logger = logging.getLogger(__name__)

# RFC-5322-ish email regex (not perfect, but good enough for OSINT purposes).
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
)


class EmailCollector(BaseCollector):
    """Gather intelligence about an email address."""

    async def collect(self, query: str) -> List[EntityResult]:
        """Run the email intelligence pipeline.

        Args:
            query: An email address string.

        Returns:
            A list containing a single ``EntityResult`` for the email, or an
            empty list if the input fails basic format validation.
        """
        email = query.strip().lower()

        # ── Step 1: Format validation ──────────────────────────────────────
        if not _EMAIL_RE.match(email):
            logger.warning("'%s' does not look like a valid email address.", email)
            return []

        domain = email.split("@", 1)[1]

        # Identify well-known providers.
        _KNOWN_PROVIDERS = {
            "gmail.com": "Google",
            "googlemail.com": "Google",
            "yahoo.com": "Yahoo",
            "outlook.com": "Microsoft",
            "hotmail.com": "Microsoft",
            "live.com": "Microsoft",
            "protonmail.com": "Proton",
            "proton.me": "Proton",
            "icloud.com": "Apple",
            "me.com": "Apple",
            "aol.com": "AOL",
            "zoho.com": "Zoho",
            "yandex.com": "Yandex",
            "mail.ru": "Mail.ru",
        }
        provider = _KNOWN_PROVIDERS.get(domain.lower(), "Unknown")

        metadata: dict = {
            "domain": domain,
            "provider": provider,
            "has_mx": False,
            "breached": False,
            "breach_count": 0,
            "breach_names": [],
            "reputation": "unknown",
            "suspicious": False,
            "references": 0,
        }
        confidence = 0.5  # default: format-only

        async with self._build_client() as client:
            # ── Step 2: MX record lookup ───────────────────────────────────
            has_mx = await self._check_mx(domain)
            metadata["has_mx"] = has_mx

            # ── Step 3: Breach / reputation check ─────────────────────────
            if settings.hibp_api_key:
                breached, breach_count, breach_names = await self._check_hibp(
                    client, email
                )
                metadata["breached"] = breached
                metadata["breach_count"] = breach_count
                metadata["breach_names"] = breach_names

                if breached:
                    confidence = 1.0
                elif has_mx:
                    confidence = 0.8
            else:
                reputation, suspicious, references = await self._check_emailrep(
                    client, email
                )
                metadata["reputation"] = reputation
                metadata["suspicious"] = suspicious
                metadata["references"] = references

                # Good reputation and valid MX → high confidence.
                if has_mx and reputation in ("high", "medium"):
                    confidence = 0.8
                elif has_mx:
                    confidence = 0.65

        result = EntityResult(
            entity_type="Email",
            value=email,
            platform="email",
            url=None,
            confidence=confidence,
            metadata=metadata,
            source="email_collector",
        )
        return [result]

    # ── Private helpers ────────────────────────────────────────────────────────

    @staticmethod
    async def _check_mx(domain: str) -> bool:
        """Return ``True`` if ``domain`` has at least one MX record.

        Uses ``dns.resolver.resolve`` in a thread executor to avoid blocking the
        event loop (dnspython is synchronous).
        """
        import asyncio

        loop = asyncio.get_event_loop()
        try:
            records = await loop.run_in_executor(
                None, lambda: dns.resolver.resolve(domain, "MX")
            )
            return len(list(records)) > 0
        except dns.resolver.NXDOMAIN:
            logger.debug("Domain %s does not exist (NXDOMAIN).", domain)
        except dns.resolver.NoAnswer:
            logger.debug("Domain %s has no MX records.", domain)
        except dns.exception.DNSException as exc:
            logger.debug("DNS error for %s: %s", domain, exc)
        return False

    async def _check_hibp(
        self,
        client: httpx.AsyncClient,
        email: str,
    ) -> tuple[bool, int, List[str]]:
        """Query Have I Been Pwned v3 for breach data.

        Returns:
            (breached: bool, breach_count: int, breach_names: List[str])
        """
        url = f"https://haveibeenpwned.com/api/v3/breachedaccount/{email}"
        headers = {
            "hibp-api-key": settings.hibp_api_key,
            "user-agent": "osint-graph/1.0",
        }
        response = await self._get(client, url, extra_headers=headers)
        if response is None:
            return False, 0, []

        if response.status_code == 404:
            # 404 from HIBP means "no breaches found" – the account is clean.
            return False, 0, []

        if response.status_code == 200:
            try:
                breaches = response.json()
                names = [b.get("Name", "") for b in breaches if isinstance(b, dict)]
                return True, len(names), names
            except Exception as exc:
                logger.warning("Failed to parse HIBP response: %s", exc)

        return False, 0, []

    async def _check_emailrep(
        self,
        client: httpx.AsyncClient,
        email: str,
    ) -> tuple[str, bool, int]:
        """Query emailrep.io for email reputation data (free, no key required).

        Returns:
            (reputation: str, suspicious: bool, references: int)
        """
        url = f"https://emailrep.io/{email}"
        headers = {"User-Agent": "osint-graph/1.0"}
        response = await self._get(client, url, extra_headers=headers)
        if response is None or response.status_code != 200:
            return "unknown", False, 0

        try:
            data = response.json()
            reputation: str = data.get("reputation", "unknown")
            suspicious: bool = bool(data.get("suspicious", False))
            references: int = int(data.get("references", 0))
            return reputation, suspicious, references
        except Exception as exc:
            logger.warning("Failed to parse emailrep.io response: %s", exc)
            return "unknown", False, 0
