"""
routers/investigate.py – Endpoints for creating and reading investigations.

Routes
------
POST /api/investigate
    Accept a query + query_type, create an Investigation node in Neo4j,
    launch a BackgroundTask to run the collectors, and return immediately
    with status="pending".

GET /api/investigation/{id}
    Return the full investigation record including all collected entities.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.collectors.email_collector import EmailCollector
from app.collectors.holehe_collector import HoleheCollector
from app.collectors.name_collector import NameCollector
from app.collectors.phone_collector import PhoneCollector
from app.collectors.username_checker import UsernameChecker
from app.extractors.entity_extractor import extract_entities
from app.extractors.relationship_mapper import map_relationships
from app.graph import neo4j_service as db
from app.models import (
    EntityResult,
    InvestigateRequest,
    InvestigateResponse,
    InvestigationDetail,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["investigations"])

# ── Collector registry ─────────────────────────────────────────────────────────

_COLLECTORS = {
    "username": UsernameChecker,
    "email": EmailCollector,
    "phone": PhoneCollector,
    "name": NameCollector,
}


# ──────────────────────────────────────────────────────────────────────────────
# Background task
# ──────────────────────────────────────────────────────────────────────────────

async def _run_investigation(investigation_id: str, query: str, query_type: str) -> None:
    """Execute the full OSINT pipeline for a given investigation.

    Steps:
    1. Mark investigation as ``running``.
    2. Run the appropriate collector for ``query_type``.
    3. Store each discovered entity in Neo4j.
    4. Run the entity extractor on any free-text metadata.
    5. Map and create relationships between stored entities.
    6. Mark investigation as ``complete`` (or ``error`` on failure).

    This function is designed to be called as a FastAPI ``BackgroundTask``.
    All exceptions are caught so they do not propagate and kill the server.
    """
    try:
        # ── Step 1: Mark as running ────────────────────────────────────────
        await db.update_investigation_status(investigation_id, "running")
        logger.info("Investigation %s started (query=%r, type=%s)", investigation_id, query, query_type)

        # ── Step 2: Run the appropriate collector ──────────────────────────
        collector_cls = _COLLECTORS.get(query_type)
        if collector_cls is None:
            raise ValueError(f"Unknown query_type: {query_type!r}")

        collector = collector_cls()
        collector_results: List[EntityResult] = await collector.collect(query)
        logger.info(
            "Investigation %s: collector returned %d entities",
            investigation_id,
            len(collector_results),
        )

        # ── Step 2b: Run Holehe for email queries (parallel enrichment) ────
        if query_type == "email":
            try:
                holehe = HoleheCollector()
                holehe_results = await holehe.collect(query)
                collector_results.extend(holehe_results)
                logger.info(
                    "Investigation %s: holehe found %d registered accounts",
                    investigation_id,
                    len(holehe_results),
                )

                # Enrich the Email entity with a summary of registered sites.
                if holehe_results:
                    site_names = [r.value for r in holehe_results]
                    for ent in collector_results:
                        if ent.entity_type == "Email":
                            ent.metadata["registered sites"] = ", ".join(site_names)
                            ent.metadata["registered site count"] = len(site_names)
                            break
            except Exception as exc:
                logger.warning(
                    "Investigation %s: holehe failed (non-fatal): %s",
                    investigation_id,
                    exc,
                )

        # ── Step 3: Store entities + build node_id map ────────────────────
        node_id_map: Dict[str, str] = {}  # entity value → node_id in Neo4j

        all_entities: List[EntityResult] = list(collector_results)

        for entity in all_entities:
            node_id = await _store_entity(investigation_id, entity)
            if node_id:
                node_id_map[entity.value] = node_id

        # ── Step 4: NER on metadata text ──────────────────────────────────
        # Skip secondary regex/NER extraction for "name" queries because the
        # name collector already returns clean, targeted results.  Running
        # regex on scraped HTML metadata (avatar URLs, etc.) produces false-
        # positive phone numbers and duplicate website nodes.
        if query_type != "name":
            # Collect all text from entity metadata for secondary extraction.
            text_chunks: List[str] = [query]
            for entity in all_entities:
                for v in entity.metadata.values():
                    if isinstance(v, str) and len(v) > 10:
                        text_chunks.append(v)

            combined_text = " ".join(text_chunks)
            extracted = extract_entities(combined_text)

            for ext in extracted:
                # Avoid duplicating entities already stored by the primary collector.
                if ext["value"] not in node_id_map:
                    ent = EntityResult(
                        entity_type=ext["entity_type"],
                        value=ext["value"],
                        confidence=ext["confidence"],
                        metadata={"method": ext["method"]},
                        source="entity_extractor",
                    )
                    node_id = await _store_entity(investigation_id, ent)
                    if node_id:
                        node_id_map[ent.value] = node_id
                        all_entities.append(ent)

        # ── Step 5: Derive and create relationships ────────────────────────
        relationship_specs = map_relationships(all_entities, node_id_map)
        for spec in relationship_specs:
            await db.create_relationship(
                spec.from_node_id,
                spec.to_node_id,
                spec.rel_type,
                dict(spec.properties),
            )

        logger.info(
            "Investigation %s complete: %d entities, %d relationships",
            investigation_id,
            len(all_entities),
            len(relationship_specs),
        )

        # ── Step 6: Mark as complete ───────────────────────────────────────
        await db.update_investigation_status(investigation_id, "complete")

    except Exception as exc:
        logger.exception(
            "Investigation %s failed with unhandled exception: %s",
            investigation_id,
            exc,
        )
        await db.update_investigation_status(
            investigation_id,
            "error",
            error=str(exc),
        )


async def _store_entity(investigation_id: str, entity: EntityResult) -> str | None:
    """Route an entity to the correct neo4j_service storage function.

    Returns the Neo4j ``node_id`` of the stored entity, or ``None`` on failure.
    """
    etype = entity.entity_type.lower()
    if etype == "username":
        return await db.store_username_entity(investigation_id, entity)
    elif etype == "email":
        return await db.store_email_entity(investigation_id, entity)
    elif etype in ("phone", "phonenumber"):
        return await db.store_phone_entity(investigation_id, entity)
    else:
        return await db.store_generic_entity(investigation_id, entity)


# ──────────────────────────────────────────────────────────────────────────────
# API endpoints
# ──────────────────────────────────────────────────────────────────────────────

@router.post(
    "/investigate",
    response_model=InvestigateResponse,
    status_code=202,
    summary="Start a new OSINT investigation",
)
async def start_investigation(
    request: InvestigateRequest,
    background_tasks: BackgroundTasks,
) -> InvestigateResponse:
    """Accept a query and immediately return an investigation ID.

    The actual OSINT data collection runs asynchronously in the background.
    Poll ``GET /api/investigation/{id}`` to check progress.
    """
    investigation_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)

    # Persist the Investigation node before returning.
    await db.create_investigation(
        investigation_id,
        request.query,
        request.query_type,
        created_at,
    )

    # Schedule the background pipeline.
    background_tasks.add_task(
        _run_investigation,
        investigation_id,
        request.query,
        request.query_type,
    )

    return InvestigateResponse(
        id=investigation_id,
        status="pending",
        message=(
            f"Investigation started for {request.query_type} '{request.query}'. "
            f"Poll /api/investigation/{investigation_id} for results."
        ),
    )


@router.get(
    "/investigation/{investigation_id}",
    response_model=InvestigationDetail,
    summary="Get investigation status and results",
)
async def get_investigation(investigation_id: str) -> InvestigationDetail:
    """Return the full investigation record, including all discovered entities.

    Raises 404 if the investigation ID is not found in Neo4j.
    """
    data = await db.get_investigation(investigation_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Investigation '{investigation_id}' not found.",
        )

    # Parse datetimes if they came back as ISO strings.
    def _parse_dt(val: Any) -> datetime | None:
        if val is None:
            return None
        if isinstance(val, datetime):
            return val
        try:
            return datetime.fromisoformat(str(val))
        except ValueError:
            return None

    return InvestigationDetail(
        id=data["id"],
        query=data["query"],
        query_type=data["query_type"],
        status=data["status"],
        created_at=_parse_dt(data["created_at"]) or datetime.now(timezone.utc),
        updated_at=_parse_dt(data.get("updated_at")),
        error_message=data.get("error_message"),
        results=data.get("results", []),
    )
