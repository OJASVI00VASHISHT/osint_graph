"""
routers/graph.py – Graph data endpoint for Sigma.js visualisation.

Routes
------
GET /api/graph/{id}
    Return nodes and edges for a given investigation in the format expected
    by Sigma.js / graphology.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.graph import neo4j_service as db
from app.models import GraphResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["graph"])


@router.get(
    "/graph/{investigation_id}",
    response_model=GraphResponse,
    summary="Get Sigma.js graph data for an investigation",
)
async def get_graph(investigation_id: str) -> GraphResponse:
    """Return ``{nodes, edges}`` suitable for rendering with Sigma.js.

    Node positions are computed with a circular layout.
    Raises 404 if the investigation is not found.
    """
    # Verify the investigation exists first.
    inv = await db.get_investigation(investigation_id)
    if inv is None:
        raise HTTPException(
            status_code=404,
            detail=f"Investigation '{investigation_id}' not found.",
        )

    graph = await db.get_graph_data(investigation_id)
    return graph
