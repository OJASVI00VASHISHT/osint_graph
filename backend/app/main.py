"""
main.py – FastAPI application entry point.

Responsibilities:
- Register the lifespan context (driver init/close).
- Mount all API routers under /api.
- Configure CORS middleware.
- Expose the health endpoint directly here for simplicity.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_driver, init_driver, is_connected
from app.models import HealthResponse
from app.routers import entities, graph, investigate, person

# ── Logging setup ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application startup and shutdown lifecycle."""
    logger.info("OSINT Graph API starting up …")
    await init_driver()
    yield
    logger.info("OSINT Graph API shutting down …")
    await close_driver()


# ── Application factory ────────────────────────────────────────────────────────

app = FastAPI(
    title="OSINT Relationship Graph API",
    description=(
        "Investigate usernames, emails, phone numbers and names. "
        "Results are stored as a graph in Neo4j and served to the Sigma.js frontend."
    ),
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────

app.include_router(investigate.router, prefix="/api")
app.include_router(graph.router, prefix="/api")
app.include_router(entities.router, prefix="/api")
app.include_router(person.router, prefix="/api")


# ── Health endpoint ────────────────────────────────────────────────────────────

@app.get(
    "/api/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="Health check – returns Neo4j connectivity status",
)
async def health_check() -> HealthResponse:
    """Return the service health and Neo4j reachability."""
    connected = await is_connected()
    return HealthResponse(
        status="ok" if connected else "degraded",
        neo4j_connected=connected,
    )

@app.delete("/api/clear", tags=["system"], summary="Nuke the database")
async def clear_all_data():
    from app.graph import neo4j_service as db
    success = await db.clear_database()
    return {"status": "ok", "success": success}
