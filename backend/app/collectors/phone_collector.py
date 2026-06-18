"""
collectors/phone_collector.py – Phone number intelligence gathering.

Pipeline
--------
1. Parse and validate the number with the ``phonenumbers`` library.
2. Extract structured metadata: country, carrier, line type.
3. Optionally query numlookupapi.com (free tier, no key required).
4. Optionally scrape shouldianswer.com for crowd-sourced reputation.
5. Return a single ``EntityResult`` with all gathered metadata.

Confidence
----------
- 0.9  → number is valid according to ``phonenumbers``
- 0.5  → number matched a rough format regex but ``phonenumbers`` rejected it
"""

from __future__ import annotations

import logging
import re
from typing import List, Optional

import phonenumbers
from phonenumbers import carrier, geocoder, number_type

from app.collectors.base import BaseCollector
from app.models import EntityResult

logger = logging.getLogger(__name__)

# Rough fallback regex to catch phone-shaped strings before phonenumbers.
_PHONE_RE = re.compile(r"[\+]?[0-9][0-9 .\-\(\)]{7,15}")

# Map phonenumbers line-type constants to human-readable strings.
_LINE_TYPE_MAP = {
    phonenumbers.PhoneNumberType.MOBILE: "mobile",
    phonenumbers.PhoneNumberType.FIXED_LINE: "fixed_line",
    phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE: "fixed_or_mobile",
    phonenumbers.PhoneNumberType.TOLL_FREE: "toll_free",
    phonenumbers.PhoneNumberType.PREMIUM_RATE: "premium_rate",
    phonenumbers.PhoneNumberType.VOIP: "voip",
    phonenumbers.PhoneNumberType.PAGER: "pager",
    phonenumbers.PhoneNumberType.UNKNOWN: "unknown",
}


class PhoneCollector(BaseCollector):
    """Gather intelligence about a phone number."""

    async def collect(self, query: str) -> List[EntityResult]:
        """Run the phone intelligence pipeline.

        Args:
            query: A phone number string (with or without country code prefix).

        Returns:
            A list containing a single ``EntityResult``, or empty if the input
            does not look like a phone number at all.
        """
        raw = query.strip()

        # Quick pre-filter.
        if not _PHONE_RE.match(raw):
            logger.warning("'%s' does not look like a phone number.", raw)
            return []

        metadata: dict = {
            "valid": False,
            "country_code": None,
            "national_number": None,
            "country": "unknown",
            "carrier": "unknown",
            "line_type": "unknown",
            "reputation": "unknown",
            "numlookup": {},
        }
        confidence = 0.5

        # ── Step 1: Parse with phonenumbers ───────────────────────────────
        parsed = self._parse_number(raw)
        if parsed and phonenumbers.is_valid_number(parsed):
            metadata["valid"] = True
            confidence = 0.9

            # International E.164 format for consistent storage.
            e164 = phonenumbers.format_number(
                parsed, phonenumbers.PhoneNumberFormat.E164
            )
            value = e164

            metadata["country_code"] = parsed.country_code
            metadata["national_number"] = str(parsed.national_number)
            metadata["country"] = geocoder.description_for_number(parsed, "en") or "unknown"
            metadata["carrier"] = carrier.name_for_number(parsed, "en") or "unknown"
            ntype = number_type(parsed)
            metadata["line_type"] = _LINE_TYPE_MAP.get(ntype, "unknown")
        else:
            # Not valid – still store what we have.
            value = raw
            logger.debug("phonenumbers could not validate '%s'.", raw)

        # ── Steps 3 & 4: External reputation checks ───────────────────────
        async with self._build_client() as client:
            # Remove all non-digit/plus characters for the API call.
            clean = re.sub(r"[^\d+]", "", value)

            # numlookupapi.com – free tier.
            numlookup = await self._check_numlookup(client, clean)
            if numlookup:
                metadata["numlookup"] = numlookup
                # If the API confirms validity, upgrade our confidence.
                if numlookup.get("valid") and not metadata["valid"]:
                    metadata["valid"] = True
                    confidence = max(confidence, 0.7)

            # shouldianswer.com – crowd-sourced reputation.
            reputation = await self._check_shouldianswer(client, clean)
            metadata["reputation"] = reputation

        return [
            EntityResult(
                entity_type="PhoneNumber",
                value=value,
                platform="phone",
                url=None,
                confidence=confidence,
                metadata=metadata,
                source="phone_collector",
            )
        ]

    # ── Private helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _parse_number(raw: str) -> Optional[phonenumbers.PhoneNumber]:
        """Try to parse ``raw`` as a phone number.

        Attempts parsing with an explicit ``+`` prefix first (international).
        If no country code is provided, checks heuristics to prioritize region IN
        (India) or US.
        """
        # Clean non-digits for heuristics
        clean_digits = re.sub(r"\D", "", raw)
        
        # 1. If starts with +, try parsing as international
        if raw.startswith("+"):
            try:
                parsed = phonenumbers.parse(raw, None)
                if phonenumbers.is_valid_number(parsed):
                    return parsed
            except phonenumbers.NumberParseException:
                pass
                
        # Heuristic for default regions order:
        # Indian mobile numbers are 10 digits starting with 6, 7, 8, or 9.
        if len(clean_digits) == 10 and clean_digits[0] in ("6", "7", "8", "9"):
            regions = ("IN", "US")
        else:
            regions = ("US", "IN")
        
        # Try regions in order
        for region in regions:
            try:
                parsed = phonenumbers.parse(raw, region)
                if phonenumbers.is_valid_number(parsed):
                    return parsed
            except phonenumbers.NumberParseException:
                pass

        # 4. Fallback: try parsing with generic + prefix
        for attempt in (raw, f"+{raw.lstrip('+')}"):
            try:
                parsed = phonenumbers.parse(attempt, None)
                if phonenumbers.is_valid_number(parsed):
                    return parsed
            except phonenumbers.NumberParseException:
                pass

        # 5. Last resort: just return whatever parses or None
        try:
            return phonenumbers.parse(raw, regions[0])
        except phonenumbers.NumberParseException:
            try:
                return phonenumbers.parse(raw, regions[1])
            except phonenumbers.NumberParseException:
                return None

    async def _check_numlookup(
        self, client, number: str
    ) -> dict:
        """Query numlookupapi.com for structured phone metadata (free, no key)."""
        url = f"https://api.numlookupapi.com/v1/info/{number}"
        response = await self._get(client, url)
        if response is None or response.status_code != 200:
            return {}
        try:
            data = response.json()
            return {
                "valid": data.get("valid", False),
                "country_name": data.get("country_name", ""),
                "carrier": data.get("carrier", ""),
                "line_type": data.get("line_type", ""),
                "location": data.get("location", ""),
            }
        except Exception as exc:
            logger.debug("numlookupapi parse error: %s", exc)
            return {}

    async def _check_shouldianswer(self, client, number: str) -> str:
        """Scrape shouldianswer.com for a crowd-sourced reputation label.

        Returns one of: ``"positive"``, ``"negative"``, ``"neutral"``, or
        ``"unknown"`` when the rating cannot be determined.
        """
        url = f"https://www.shouldianswer.com/phone-number/{number}"
        response = await self._get(client, url)
        if response is None or response.status_code != 200:
            return "unknown"

        text = response.text.lower()

        # shouldianswer wraps its rating in class="rating-XXX" elements.
        if "rating-positive" in text or "safe" in text:
            return "positive"
        if "rating-negative" in text or "dangerous" in text or "scam" in text:
            return "negative"
        if "rating-neutral" in text or "neutral" in text:
            return "neutral"
        return "unknown"
