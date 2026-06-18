"""
models.py – Pydantic schemas for request/response payloads and internal data
transfer objects used across the application.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────────────────────
# Request models
# ──────────────────────────────────────────────────────────────────────────────

class InvestigateRequest(BaseModel):
    """Payload accepted by POST /api/investigate."""

    query: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="The search target: a username, email address, phone number, or full name.",
    )
    query_type: str = Field(
        ...,
        pattern="^(username|email|phone|name)$",
        description="Type of the query. Must be one of: username, email, phone, name.",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Internal data-transfer objects
# ──────────────────────────────────────────────────────────────────────────────

class EntityResult(BaseModel):
    """Represents a single discovered entity returned by a collector."""

    entity_type: str = Field(
        ...,
        description="Node label in Neo4j: Username, Email, PhoneNumber, Organization, Location, Website, Person.",
    )
    value: str = Field(..., description="The canonical value of the entity (e.g. the username string).")
    platform: Optional[str] = Field(None, description="Platform or site name where this entity was found.")
    url: Optional[str] = Field(None, description="Direct URL to the profile or resource.")
    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Confidence that this entity is real / relevant (0.0 – 1.0).",
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary key-value pairs stored alongside the entity node.",
    )
    source: str = Field(
        default="collector",
        description="Which collector or extractor produced this result.",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Response models
# ──────────────────────────────────────────────────────────────────────────────

class InvestigateResponse(BaseModel):
    """Immediate response returned by POST /api/investigate."""

    id: str = Field(..., description="UUID of the newly created investigation.")
    status: str = Field(..., description="Initial status – always 'pending'.")
    message: str = Field(..., description="Human-readable confirmation message.")


class InvestigationDetail(BaseModel):
    """Full investigation record returned by GET /api/investigation/{id}."""

    id: str
    query: str
    query_type: str
    status: str  # pending | running | complete | error
    created_at: datetime
    updated_at: Optional[datetime] = None
    error_message: Optional[str] = None
    results: List[Dict[str, Any]] = Field(default_factory=list)


class GraphNode(BaseModel):
    """A single node in the Sigma.js graph payload."""

    id: str = Field(..., description="Unique node identifier (node_id UUID).")
    label: str = Field(..., description="Display label shown on the graph node.")
    node_type: str = Field(..., description="Neo4j label / entity type.")
    x: float = Field(0.0, description="X coordinate for initial layout.")
    y: float = Field(0.0, description="Y coordinate for initial layout.")
    size: float = Field(10.0, description="Visual size of the node.")
    color: str = Field("#6366f1", description="Hex color for the node.")
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    """A single directed edge in the Sigma.js graph payload."""

    id: str = Field(..., description="Unique edge identifier.")
    source: str = Field(..., description="Source node_id.")
    target: str = Field(..., description="Target node_id.")
    label: str = Field(..., description="Relationship type label.")
    color: str = Field("#94a3b8", description="Hex color for the edge.")


class GraphResponse(BaseModel):
    """Payload returned by GET /api/graph/{id}."""

    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)


class HealthResponse(BaseModel):
    """Payload returned by GET /api/health."""

    status: str
    neo4j_connected: bool
