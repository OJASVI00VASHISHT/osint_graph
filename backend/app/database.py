"""
database.py – Neo4j async driver lifecycle management.

Exposes a module-level ``driver`` object that is initialised once during
application startup (via the FastAPI lifespan context) and closed on shutdown.

All other modules should import ``get_session`` to obtain a short-lived async
session, or import ``driver`` directly for low-level access.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

from neo4j import AsyncDriver, AsyncGraphDatabase

from app.config import settings

logger = logging.getLogger(__name__)

# Module-level driver reference.  Set by ``init_driver()`` and cleared by
# ``close_driver()``.
driver: Optional[AsyncDriver] = None


async def init_driver() -> None:
    """Create the Neo4j async driver and verify connectivity.

    Called once during application startup.  Failures are logged but do NOT
    crash the application so that the API remains reachable even when Neo4j is
    temporarily unavailable.
    """
    global driver
    try:
        driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
            # Keep a small connection pool; the application is I/O-bound, not
            # Neo4j-query-bound.
            max_connection_pool_size=20,
        )
        # Verify the connection is actually working.
        await driver.verify_connectivity()
        logger.info("Neo4j driver initialised – connected to %s", settings.neo4j_uri)

        # Create uniqueness constraints so that MERGE operations are efficient
        # and duplicate nodes are never accidentally created.
        await _create_constraints()
    except Exception as exc:
        logger.error("Failed to initialise Neo4j driver: %s", exc)
        driver = None


async def close_driver() -> None:
    """Gracefully close the Neo4j driver.  Called during application shutdown."""
    global driver
    if driver is not None:
        await driver.close()
        driver = None
        logger.info("Neo4j driver closed.")


async def _create_constraints() -> None:
    """Idempotently create Neo4j schema constraints for all node labels.

    Neo4j 5.x syntax is used (``CREATE CONSTRAINT IF NOT EXISTS``).
    """
    if driver is None:
        return

    constraints = [
        # Each label gets a uniqueness constraint on its ``node_id`` property.
        ("investigation_node_id", "Investigation", "node_id"),
        ("username_node_id", "Username", "node_id"),
        ("email_node_id", "Email", "node_id"),
        ("phone_node_id", "PhoneNumber", "node_id"),
        ("org_node_id", "Organization", "node_id"),
        ("location_node_id", "Location", "node_id"),
        ("website_node_id", "Website", "node_id"),
        ("person_node_id", "Person", "node_id"),
    ]

    async with driver.session(database="neo4j") as session:
        for constraint_name, label, prop in constraints:
            cypher = (
                f"CREATE CONSTRAINT {constraint_name} IF NOT EXISTS "
                f"FOR (n:{label}) REQUIRE n.node_id IS UNIQUE"
            )
            try:
                await session.run(cypher)
            except Exception as exc:
                logger.warning(
                    "Could not create constraint %s: %s", constraint_name, exc
                )


@asynccontextmanager
async def get_session() -> AsyncGenerator:
    """Async context manager that yields a Neo4j session.

    Usage::

        async with get_session() as session:
            result = await session.run("RETURN 1")

    Raises ``RuntimeError`` if the driver has not been initialised.
    """
    if driver is None:
        raise RuntimeError(
            "Neo4j driver is not initialised.  "
            "Ensure ``init_driver()`` was called during application startup."
        )
    async with driver.session(database="neo4j") as session:
        yield session


async def is_connected() -> bool:
    """Return ``True`` if the driver is present and the server is reachable."""
    if driver is None:
        return False
    try:
        await driver.verify_connectivity()
        return True
    except Exception:
        return False
