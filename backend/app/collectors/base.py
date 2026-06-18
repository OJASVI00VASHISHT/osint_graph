"""
collectors/base.py – Abstract base class and shared utilities for all collectors.

Every collector in this package should subclass ``BaseCollector`` and implement
the ``collect`` coroutine.  The base class provides:

- A pre-configured ``httpx.AsyncClient`` with fake-useragent rotation,
  a shared timeout, and sensible default headers.
- Helper methods: ``_get``, ``_random_delay``.
- Graceful error handling for network failures.
"""

from __future__ import annotations

import asyncio
import logging
import random
from abc import ABC, abstractmethod
from typing import List, Optional

import httpx
from fake_useragent import UserAgent

from app.config import settings
from app.models import EntityResult

logger = logging.getLogger(__name__)

# Module-level UserAgent instance (initialised lazily to avoid startup cost).
_ua: Optional[UserAgent] = None


def _get_user_agent() -> str:
    """Return a random User-Agent string from the fake-useragent pool."""
    global _ua
    if _ua is None:
        try:
            _ua = UserAgent(browsers=["chrome", "firefox", "safari"])
        except Exception:
            # If the online database cannot be fetched, fall back to a static UA.
            return (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
    return _ua.random


class BaseCollector(ABC):
    """Abstract base for all OSINT collectors.

    Subclasses must implement :meth:`collect`.  They may optionally override
    :meth:`_build_client` to customise the HTTP client.
    """

    def __init__(self) -> None:
        self.timeout = settings.request_timeout
        self.logger = logging.getLogger(self.__class__.__module__)

    def _build_client(self) -> httpx.AsyncClient:
        """Construct a pre-configured ``httpx.AsyncClient``.

        The client uses:
        - A random User-Agent on every instantiation.
        - ``follow_redirects=True`` so profile pages that redirect still work.
        - The globally configured request timeout.
        """
        return httpx.AsyncClient(
            headers={"User-Agent": _get_user_agent()},
            timeout=self.timeout,
            follow_redirects=True,
        )

    async def _get(
        self,
        client: httpx.AsyncClient,
        url: str,
        extra_headers: Optional[dict] = None,
    ) -> Optional[httpx.Response]:
        """Perform an async GET request, returning ``None`` on network errors.

        Args:
            client:        The shared ``httpx.AsyncClient``.
            url:           The URL to fetch.
            extra_headers: Optional additional headers to merge into the request.
        """
        headers = {}
        if extra_headers:
            headers.update(extra_headers)
        try:
            response = await client.get(url, headers=headers)
            return response
        except httpx.TimeoutException:
            self.logger.warning("Timeout fetching %s", url)
        except httpx.ConnectError:
            self.logger.warning("Connection error fetching %s", url)
        except httpx.HTTPError as exc:
            self.logger.warning("HTTP error fetching %s: %s", url, exc)
        except Exception as exc:
            self.logger.warning("Unexpected error fetching %s: %s", url, exc)
        return None

    @staticmethod
    async def _random_delay(base: float = 0.1, jitter: float = 0.2) -> None:
        """Sleep for a random duration to avoid triggering rate limits.

        Args:
            base:   Minimum sleep time in seconds.
            jitter: Maximum additional random time in seconds.
        """
        await asyncio.sleep(base + random.uniform(0, jitter))

    @abstractmethod
    async def collect(self, query: str) -> List[EntityResult]:
        """Run the collection pipeline for ``query`` and return all found entities.

        Args:
            query: The raw search term (username, email, phone, name).

        Returns:
            A list of :class:`~app.models.EntityResult` objects.
        """
        ...
