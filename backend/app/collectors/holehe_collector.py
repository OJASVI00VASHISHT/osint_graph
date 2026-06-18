"""
collectors/holehe_collector.py – Check which websites an email is registered on.

Uses the ``holehe`` library to probe "forgot password" flows across 120+ sites.
Each site where the email is found yields a separate ``EntityResult`` of type
``Website`` (for the platform URL) — enabling graph connections between the
email and the services it is registered on.

Broken / erroring modules are silently skipped so they never appear in results.
"""

from __future__ import annotations

import asyncio
import logging
from typing import List

import httpx

from app.collectors.base import BaseCollector
from app.models import EntityResult

logger = logging.getLogger(__name__)


class HoleheCollector(BaseCollector):
    """Discover which online services an email address is registered on."""

    async def collect(self, query: str) -> List[EntityResult]:
        """Run holehe modules against ``query`` and return found accounts.

        Args:
            query: An email address string.

        Returns:
            A list of ``EntityResult`` objects — one per site where the email
            was confirmed as registered.  Sites that error or return
            ``not found`` are silently excluded.
        """
        email = query.strip().lower()
        results: List[EntityResult] = []

        try:
            from holehe.core import import_submodules
        except ImportError:
            logger.error(
                "holehe is not installed. Run `pip install holehe` to enable "
                "email-to-site registration checks."
            )
            return []

        # Use holehe's own import_submodules to discover all checker functions.
        try:
            modules = import_submodules("holehe.modules")
        except Exception as exc:
            logger.error("Failed to import holehe modules: %s", exc)
            return []

        # Build list of (name, coroutine_func) pairs.
        checkers = []
        for full_name, mod in modules.items():
            short_name = full_name.split(".")[-1]
            func = getattr(mod, short_name, None)
            if func and asyncio.iscoroutinefunction(func):
                checkers.append((short_name, func))

        if not checkers:
            logger.warning("No holehe modules could be loaded.")
            return []

        logger.info(
            "Running %d holehe modules for email %r", len(checkers), email
        )

        # holehe modules expect an httpx.AsyncClient and a list to append
        # their result dict to.
        out: list = []

        async with httpx.AsyncClient(timeout=20.0) as client:
            tasks = []
            for name, func in checkers:
                tasks.append(
                    self._safe_run_module(name, func, email, client, out)
                )
            await asyncio.gather(*tasks)

        # Process holehe output list.
        for entry in out:
            try:
                exists = entry.get("exists", False)
                if not exists:
                    continue

                site_name = entry.get("name", "unknown")
                site_domain = entry.get("domain", "")
                rate_limited = entry.get("rateLimit", False)

                if rate_limited:
                    # Don't report rate-limited results — they're unreliable.
                    logger.debug("Skipping %s (rate limited)", site_name)
                    continue

                site_url = f"https://{site_domain}" if site_domain else None

                # Extract additional recovery info holehe sometimes provides.
                email_recovery = entry.get("emailrecovery") or ""
                phone_recovery = entry.get("phoneNumber") or ""
                detection_method = entry.get("method", "unknown")
                others = entry.get("others") or ""

                result = EntityResult(
                    entity_type="Website",
                    value=site_name,
                    platform=site_name.lower(),
                    url=site_url,
                    confidence=0.85,
                    metadata={
                        "registered": True,
                        "domain": site_domain,
                        "detection method": detection_method,
                        "email recovery": email_recovery,
                        "phone recovery": phone_recovery,
                        "other info": others if others else "",
                        "source": "holehe",
                    },
                    source="holehe_collector",
                )
                results.append(result)
            except Exception:
                # Malformed entry — skip.
                continue

        logger.info(
            "Holehe found %d registered accounts for %r", len(results), email
        )
        return results

    @staticmethod
    async def _safe_run_module(
        name: str,
        func,
        email: str,
        client: httpx.AsyncClient,
        out: list,
    ) -> None:
        """Run a single holehe module, catching *all* exceptions.

        If the module errors out (network failure, site changed its HTML,
        unexpected response, etc.) we log it at DEBUG level and move on.
        The user never sees broken modules in the results.
        """
        try:
            await asyncio.wait_for(
                func(email, client, out),
                timeout=15.0,
            )
        except asyncio.TimeoutError:
            logger.debug("Holehe module %s timed out", name)
        except Exception as exc:
            logger.debug("Holehe module %s failed: %s", name, exc)
