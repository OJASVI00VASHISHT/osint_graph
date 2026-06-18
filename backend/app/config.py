"""
config.py – Application configuration loaded from environment variables.

Uses pydantic-settings to validate and expose all runtime configuration.
Sensible defaults are provided so the application can run without a .env file
during development.
"""

from __future__ import annotations

import json
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration object.  All values can be overridden via
    environment variables or a ``.env`` file in the project root."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Neo4j ──────────────────────────────────────────────────────────────
    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "osintgraph2024"

    # ── External API keys (optional) ───────────────────────────────────────
    hibp_api_key: str = ""  # Have I Been Pwned – leave empty to use emailrep.io
    groq_api_key: str = ""  # Groq API key for CDR/IPDR analysis

    # ── HTTP client tuning ─────────────────────────────────────────────────
    request_timeout: float = 10.0          # seconds per outbound request
    username_check_delay: float = 0.15     # base delay between username checks

    # ── CORS ───────────────────────────────────────────────────────────────
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> List[str]:
        """Convert comma-separated string or JSON array to list of origins."""
        import json
        stripped = self.cors_origins.strip()
        if stripped.startswith("["):
            try:
                return json.loads(stripped)
            except Exception:
                pass
        return [origin.strip() for origin in stripped.split(",") if origin.strip()]


# Module-level singleton – import this everywhere.
settings = Settings()
