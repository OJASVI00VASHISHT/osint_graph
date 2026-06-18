"""
routers/entities.py – Paginated entity listing endpoint.

Routes
------
GET /api/entities?skip=0&limit=100
    Return a paginated list of all entity nodes stored in Neo4j (excluding
    Investigation nodes).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Query

from app.graph import neo4j_service as db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["entities"])


@router.get(
    "/entities",
    response_model=List[Dict[str, Any]],
    summary="List all entities stored in the graph database",
)
async def list_entities(
    skip: int = Query(default=0, ge=0, description="Number of records to skip."),
    limit: int = Query(
        default=100,
        ge=1,
        le=1000,
        description="Maximum number of records to return.",
    ),
) -> List[Dict[str, Any]]:
    """Return a paginated list of all entity nodes (not Investigation nodes).

    Each item in the list is a dict containing the node properties plus a
    ``node_type`` field indicating the Neo4j label.

    Args:
        skip:  Offset for pagination (default 0).
        limit: Page size (default 100, max 1000).
    """
    entities = await db.get_all_entities(skip=skip, limit=limit)
    return entities
