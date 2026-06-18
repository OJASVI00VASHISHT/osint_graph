"""
graph/neo4j_service.py – High-level async Neo4j operations.

All database interactions for the OSINT Graph application go through this
module.  Every function obtains its own session from ``database.get_session``
so callers do not need to manage sessions themselves.

If Neo4j is offline or not configured, this service automatically falls back
to a local JSON-based database at ``backend/data/fallback_db.json`` so that
the application remains fully functional.
"""

from __future__ import annotations

import json as _json
import logging
import math
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.database import driver, get_session
from app.models import EntityResult, GraphEdge, GraphNode, GraphResponse

logger = logging.getLogger(__name__)

# ── Colour mapping ─────────────────────────────────────────────────────────────

_NODE_COLOURS: Dict[str, str] = {
    "Investigation": "#f59e0b",
    "Username": "#6366f1",
    "Email": "#10b981",
    "PhoneNumber": "#ef4444",
    "Organization": "#3b82f6",
    "Location": "#8b5cf6",
    "Website": "#06b6d4",
    "Person": "#f97316",
}

_DEFAULT_COLOUR = "#94a3b8"


def _now() -> datetime:
    """Return the current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)


def _new_id() -> str:
    """Generate a new UUID4 string."""
    return str(uuid.uuid4())


# ── Fallback Database Configuration ───────────────────────────────────────────

_FALLBACK_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "fallback_db.json",
)


def _use_fallback() -> bool:
    """Return True if the Neo4j driver is not active/initialized."""
    return driver is None


def _load_fallback_db() -> Dict[str, Any]:
    """Load the fallback JSON database from disk."""
    if not os.path.exists(_FALLBACK_FILE):
        try:
            os.makedirs(os.path.dirname(_FALLBACK_FILE), exist_ok=True)
        except Exception:
            pass
        return {"investigations": {}, "entities": {}, "relationships": []}
    try:
        with open(_FALLBACK_FILE, "r", encoding="utf-8") as f:
            return _json.load(f)
    except Exception:
        return {"investigations": {}, "entities": {}, "relationships": []}


def _save_fallback_db(db: Dict[str, Any]) -> None:
    """Save the fallback JSON database to disk."""
    try:
        os.makedirs(os.path.dirname(_FALLBACK_FILE), exist_ok=True)
        with open(_FALLBACK_FILE, "w", encoding="utf-8") as f:
            _json.dump(db, f, indent=2, ensure_ascii=False)
    except Exception as exc:
        logger.error("Failed to save fallback database: %s", exc)


# ──────────────────────────────────────────────────────────────────────────────
# Investigation CRUD
# ──────────────────────────────────────────────────────────────────────────────

async def create_investigation(
    investigation_id: str,
    query: str,
    query_type: str,
    created_at: datetime,
) -> None:
    """Persist a new Investigation node.

    Uses MERGE (or fallback JSON) so that re-running the same investigation ID
    is idempotent.
    """
    if _use_fallback():
        db = _load_fallback_db()
        db["investigations"][investigation_id] = {
            "node_id": investigation_id,
            "id": investigation_id,
            "query": query,
            "query_type": query_type,
            "status": "pending",
            "created_at": created_at.isoformat(),
            "updated_at": created_at.isoformat(),
            "error_message": None,
        }
        _save_fallback_db(db)
        logger.info("Fallback DB: Created Investigation node %s", investigation_id)
        return

    cypher = """
    MERGE (i:Investigation {node_id: $node_id})
    ON CREATE SET
        i.id         = $node_id,
        i.query      = $query,
        i.query_type = $query_type,
        i.status     = 'pending',
        i.created_at = $created_at,
        i.updated_at = $created_at
    """
    params: Dict[str, Any] = {
        "node_id": investigation_id,
        "query": query,
        "query_type": query_type,
        "created_at": created_at.isoformat(),
    }
    try:
        async with get_session() as session:
            await session.run(cypher, params)
        logger.info("Created Investigation node %s", investigation_id)
    except Exception as exc:
        logger.error("create_investigation failed: %s", exc)
        raise


async def update_investigation_status(
    investigation_id: str,
    status: str,
    error: Optional[str] = None,
) -> None:
    """Update the status (and optional error message) of an Investigation node."""
    if _use_fallback():
        db = _load_fallback_db()
        if investigation_id in db["investigations"]:
            db["investigations"][investigation_id]["status"] = status
            db["investigations"][investigation_id]["updated_at"] = _now().isoformat()
            db["investigations"][investigation_id]["error_message"] = error
            _save_fallback_db(db)
            logger.info("Fallback DB: Investigation %s → status=%s", investigation_id, status)
        return

    cypher = """
    MATCH (i:Investigation {node_id: $node_id})
    SET i.status     = $status,
        i.updated_at = $updated_at,
        i.error_message = $error
    """
    params: Dict[str, Any] = {
        "node_id": investigation_id,
        "status": status,
        "updated_at": _now().isoformat(),
        "error": error,
    }
    try:
        async with get_session() as session:
            await session.run(cypher, params)
        logger.debug("Investigation %s → status=%s", investigation_id, status)
    except Exception as exc:
        logger.error("update_investigation_status failed: %s", exc)


async def get_investigation(investigation_id: str) -> Optional[Dict[str, Any]]:
    """Fetch an investigation together with all its contained entity nodes.

    Returns a dict matching the ``InvestigationDetail`` schema, or ``None`` if
    the investigation does not exist.
    """
    if _use_fallback():
        db = _load_fallback_db()
        inv = db["investigations"].get(investigation_id)
        if not inv:
            return None

        # Find all entity IDs via CONTAINS relationships
        entity_ids = [
            r["to"] for r in db["relationships"]
            if r["from"] == investigation_id and r["type"] == "CONTAINS"
        ]

        entities = []
        for eid in entity_ids:
            ent = db["entities"].get(eid)
            if ent:
                entities.append({
                    "node_id": ent.get("node_id"),
                    "label": ent.get("label", "Person"),
                    "value": ent.get("value", ""),
                    "platform": ent.get("platform"),
                    "url": ent.get("url"),
                    "confidence": ent.get("confidence", 1.0),
                    "metadata": ent.get("metadata", {}),
                })

        return {
            "id": inv["node_id"],
            "query": inv["query"],
            "query_type": inv["query_type"],
            "status": inv["status"],
            "created_at": inv["created_at"],
            "updated_at": inv["updated_at"],
            "error_message": inv["error_message"],
            "results": entities,
        }

    cypher = """
    MATCH (i:Investigation {node_id: $node_id})
    OPTIONAL MATCH (i)-[:CONTAINS]->(e)
    RETURN i,
           collect({
               node_id:    e.node_id,
               label:      labels(e)[0],
               value:      e.value,
               platform:   e.platform,
               url:        e.url,
               confidence: e.confidence,
               metadata:   e.metadata
           }) AS entities
    """
    try:
        async with get_session() as session:
            result = await session.run(cypher, {"node_id": investigation_id})
            record = await result.single()
            if record is None:
                return None

            inv = dict(record["i"])
            raw_entities: list = record["entities"]

            # Filter out the null placeholder that Neo4j returns when OPTIONAL
            # MATCH finds no results.
            entities = [
                e for e in raw_entities if e.get("node_id") is not None
            ]

            # Deserialize metadata JSON strings back into dictionaries
            for e in entities:
                if isinstance(e.get("metadata"), str):
                    try:
                        e["metadata"] = _json.loads(e["metadata"])
                    except Exception:
                        e["metadata"] = {}

            return {
                "id": inv.get("node_id", investigation_id),
                "query": inv.get("query", ""),
                "query_type": inv.get("query_type", ""),
                "status": inv.get("status", "unknown"),
                "created_at": inv.get("created_at"),
                "updated_at": inv.get("updated_at"),
                "error_message": inv.get("error_message"),
                "results": entities,
            }
    except Exception as exc:
        logger.error("get_investigation failed: %s", exc)
        return None


# ──────────────────────────────────────────────────────────────────────────────
# Entity storage helpers
# ──────────────────────────────────────────────────────────────────────────────

async def _store_entity(
    investigation_id: str,
    label: str,
    entity: EntityResult,
) -> Optional[str]:
    """Generic helper to MERGE an entity node and link it to the Investigation.

    Returns the ``node_id`` of the stored entity so the caller can create
    additional relationships.
    """
    if _use_fallback():
        db = _load_fallback_db()

        # Check if this exact entity already exists
        existing_id = None
        for eid, ent in db["entities"].items():
            if ent["value"] == entity.value and ent["label"] == label:
                existing_id = eid
                break

        if existing_id:
            node_id = existing_id
            # Update confidence if the new result has higher confidence
            existing_conf = db["entities"][node_id].get("confidence", 0.0)
            if entity.confidence > existing_conf:
                db["entities"][node_id]["confidence"] = entity.confidence
            db["entities"][node_id]["updated_at"] = _now().isoformat()
        else:
            node_id = _new_id()
            db["entities"][node_id] = {
                "node_id": node_id,
                "label": label,
                "value": entity.value,
                "platform": entity.platform,
                "url": entity.url,
                "confidence": entity.confidence,
                "source": entity.source,
                "metadata": entity.metadata,
                "created_at": _now().isoformat(),
                "updated_at": _now().isoformat(),
            }

        # Add CONTAINS link from Investigation to Entity
        has_link = any(
            r["from"] == investigation_id and r["to"] == node_id and r["type"] == "CONTAINS"
            for r in db["relationships"]
        )
        if not has_link:
            db["relationships"].append({
                "from": investigation_id,
                "to": node_id,
                "type": "CONTAINS",
                "props": {},
            })

        _save_fallback_db(db)
        return node_id

    node_id = _new_id()
    cypher = f"""
    MERGE (e:{label} {{value: $value}})
    ON CREATE SET
        e.node_id    = $node_id,
        e.value      = $value,
        e.platform   = $platform,
        e.url        = $url,
        e.confidence = $confidence,
        e.source     = $source,
        e.metadata   = $metadata,
        e.created_at = $created_at
    ON MATCH SET
        e.confidence = CASE WHEN $confidence > e.confidence THEN $confidence ELSE e.confidence END,
        e.updated_at = $created_at
    WITH e
    MATCH (i:Investigation {{node_id: $investigation_id}})
    MERGE (i)-[:CONTAINS]->(e)
    RETURN e.node_id AS node_id
    """

    params: Dict[str, Any] = {
        "node_id": node_id,
        "value": entity.value,
        "platform": entity.platform,
        "url": entity.url,
        "confidence": entity.confidence,
        "source": entity.source,
        # Neo4j cannot store arbitrary dicts, so serialise metadata as JSON.
        "metadata": _json.dumps(entity.metadata),
        "created_at": _now().isoformat(),
        "investigation_id": investigation_id,
    }
    try:
        async with get_session() as session:
            result = await session.run(cypher, params)
            record = await result.single()
            if record:
                return record["node_id"]
            return node_id
    except Exception as exc:
        logger.error("_store_entity (%s) failed: %s", label, exc)
        return None


async def store_username_entity(
    investigation_id: str, entity: EntityResult
) -> Optional[str]:
    """Store a Username entity and link it to the investigation."""
    return await _store_entity(investigation_id, "Username", entity)


async def store_email_entity(
    investigation_id: str, entity: EntityResult
) -> Optional[str]:
    """Store an Email entity and link it to the investigation."""
    return await _store_entity(investigation_id, "Email", entity)


async def store_phone_entity(
    investigation_id: str, entity: EntityResult
) -> Optional[str]:
    """Store a PhoneNumber entity and link it to the investigation."""
    return await _store_entity(investigation_id, "PhoneNumber", entity)


async def store_generic_entity(
    investigation_id: str, entity: EntityResult
) -> Optional[str]:
    """Store any other entity type (Person, Organization, Location, Website)."""
    label_map = {
        "person": "Person",
        "organization": "Organization",
        "location": "Location",
        "website": "Website",
        "username": "Username",
        "email": "Email",
        "phone": "PhoneNumber",
        "phonenumber": "PhoneNumber",
    }
    label = label_map.get(entity.entity_type.lower(), entity.entity_type)
    return await _store_entity(investigation_id, label, entity)


# ──────────────────────────────────────────────────────────────────────────────
# Relationship creation
# ──────────────────────────────────────────────────────────────────────────────

async def create_relationship(
    from_node_id: str,
    to_node_id: str,
    rel_type: str,
    properties: Optional[Dict[str, Any]] = None,
) -> None:
    """Create a directed relationship between two nodes by their node_ids."""
    if properties is None:
        properties = {}

    if _use_fallback():
        db = _load_fallback_db()
        # Verify both source and target exist
        src_exists = (from_node_id in db["investigations"] or from_node_id in db["entities"])
        tgt_exists = (to_node_id in db["investigations"] or to_node_id in db["entities"])

        if src_exists and tgt_exists:
            # Check if relationship already exists
            has_rel = any(
                r["from"] == from_node_id and r["to"] == to_node_id and r["type"] == rel_type
                for r in db["relationships"]
            )
            if not has_rel:
                db["relationships"].append({
                    "from": from_node_id,
                    "to": to_node_id,
                    "type": rel_type,
                    "props": properties,
                })
                _save_fallback_db(db)
                logger.info("Fallback DB: Created relationship %s -[%s]-> %s", from_node_id, rel_type, to_node_id)
        return

    cypher = f"""
    MATCH (a {{node_id: $from_id}})
    MATCH (b {{node_id: $to_id}})
    MERGE (a)-[r:{rel_type}]->(b)
    SET r += $props
    """
    try:
        async with get_session() as session:
            await session.run(
                cypher,
                {
                    "from_id": from_node_id,
                    "to_id": to_node_id,
                    "props": properties,
                },
            )
        logger.debug(
            "Relationship %s -[%s]-> %s created", from_node_id, rel_type, to_node_id
        )
    except Exception as exc:
        logger.error("create_relationship failed: %s", exc)


# ──────────────────────────────────────────────────────────────────────────────
# Graph data retrieval
# ──────────────────────────────────────────────────────────────────────────────

def _circular_position(index: int, total: int, radius: float = 400.0):
    """Return (x, y) for node at ``index`` on a circle of ``radius``."""
    if total <= 1:
        return 0.0, 0.0
    angle = (2 * math.pi * index) / total
    return radius * math.cos(angle), radius * math.sin(angle)


async def get_graph_data(investigation_id: str) -> GraphResponse:
    """Build a GraphResponse (nodes + edges) for the Sigma.js frontend."""
    if _use_fallback():
        db = _load_fallback_db()
        nodes_map: Dict[str, GraphNode] = {}
        edges: List[GraphEdge] = []

        inv = db["investigations"].get(investigation_id)
        if not inv:
            return GraphResponse(nodes=[], edges=[])

        # Add Investigation root node
        nodes_map[investigation_id] = GraphNode(
            id=investigation_id,
            label=inv.get("query", "Investigation"),
            node_type="Investigation",
            size=18.0,
            color=_NODE_COLOURS["Investigation"],
            metadata={},
        )

        # Get contained entities
        entity_ids = [
            r["to"] for r in db["relationships"]
            if r["from"] == investigation_id and r["type"] == "CONTAINS"
        ]

        # Add entity nodes
        for eid in entity_ids:
            ent = db["entities"].get(eid)
            if ent:
                node_type = ent["label"]
                nodes_map[eid] = GraphNode(
                    id=eid,
                    label=str(ent.get("value", eid[:8])),
                    node_type=node_type,
                    size=12.0,
                    color=_NODE_COLOURS.get(node_type, _DEFAULT_COLOUR),
                    metadata={
                        "platform": ent.get("platform"),
                        "url": ent.get("url"),
                        "email": ent.get("email"),
                        "phone_number": ent.get("phone_number"),
                        "social_media_id": ent.get("social_media_id"),
                        "picture": ent.get("picture"),
                        "links": ent.get("links"),
                        "cdr_data": ent.get("cdr_data"),
                        "ipdr_data": ent.get("ipdr_data"),
                        "cdr_analysis": ent.get("cdr_analysis"),
                        "ipdr_analysis": ent.get("ipdr_analysis"),
                    },
                )

        # Assign layout positions
        node_list = list(nodes_map.values())
        total = len(node_list)
        for idx, node in enumerate(node_list):
            x, y = _circular_position(idx, total)
            node.x = x
            node.y = y

        # Add relationships between the gathered nodes
        seen_edges = set()
        for r in db["relationships"]:
            src = r["from"]
            tgt = r["to"]
            r_type = r["type"]

            if src in nodes_map and tgt in nodes_map:
                edge_key = f"{src}→{r_type}→{tgt}"
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    edges.append(
                        GraphEdge(
                            id=str(uuid.uuid4()),
                            source=src,
                            target=tgt,
                            label=r_type,
                            color="#64748b" if r_type == "CONTAINS" else "#94a3b8",
                        )
                    )

        return GraphResponse(nodes=list(nodes_map.values()), edges=edges)

    cypher = """
    MATCH (i:Investigation {node_id: $id})
    OPTIONAL MATCH (i)-[:CONTAINS]->(n)
    OPTIONAL MATCH (n)-[r]->(m)
    WHERE NOT (m:Investigation)
    RETURN i,
           n, labels(n)  AS n_labels,
           r, type(r)    AS r_type,
           m, labels(m)  AS m_labels
    """
    nodes_map: Dict[str, GraphNode] = {}
    edges: List[GraphEdge] = []

    try:
        async with get_session() as session:
            result = await session.run(cypher, {"id": investigation_id})
            records = await result.data()

        # ── First pass: collect all unique nodes ───────────────────────────
        for record in records:
            inv_node = record.get("i")
            if inv_node and "node_id" in inv_node:
                nid = inv_node["node_id"]
                if nid not in nodes_map:
                    nodes_map[nid] = GraphNode(
                        id=nid,
                        label=inv_node.get("query", "Investigation"),
                        node_type="Investigation",
                        size=18.0,
                        color=_NODE_COLOURS["Investigation"],
                        metadata={},
                    )

            for node_key, labels_key in [("n", "n_labels"), ("m", "m_labels")]:
                n = record.get(node_key)
                labels = record.get(labels_key) or []
                if n and "node_id" in n:
                    nid = n["node_id"]
                    if nid not in nodes_map:
                        node_type = labels[0] if labels else "Entity"
                        nodes_map[nid] = GraphNode(
                            id=nid,
                            label=str(n.get("value", nid[:8])),
                            node_type=node_type,
                            size=12.0,
                            color=_NODE_COLOURS.get(node_type, _DEFAULT_COLOUR),
                            metadata={
                                "platform": n.get("platform"),
                                "url": n.get("url"),
                                "email": n.get("email"),
                                "phone_number": n.get("phone_number"),
                                "social_media_id": n.get("social_media_id"),
                                "picture": n.get("picture"),
                                "links": n.get("links"),
                                "cdr_data": n.get("cdr_data"),
                                "ipdr_data": n.get("ipdr_data"),
                                "cdr_analysis": n.get("cdr_analysis"),
                                "ipdr_analysis": n.get("ipdr_analysis"),
                            },
                        )

        # ── Assign circular layout positions ──────────────────────────────
        node_list = list(nodes_map.values())
        total = len(node_list)
        for idx, node in enumerate(node_list):
            x, y = _circular_position(idx, total)
            node.x = x
            node.y = y

        # ── Second pass: collect edges ─────────────────────────────────────
        seen_edges: set = set()
        for record in records:
            r = record.get("r")
            r_type = record.get("r_type")
            n = record.get("n")
            m = record.get("m")

            if r is not None and n and m:
                src = n.get("node_id")
                tgt = m.get("node_id")
                if src and tgt:
                    edge_key = f"{src}→{r_type}→{tgt}"
                    if edge_key not in seen_edges:
                        seen_edges.add(edge_key)
                        edges.append(
                            GraphEdge(
                                id=str(uuid.uuid4()),
                                source=src,
                                target=tgt,
                                label=r_type or "RELATED",
                                color="#94a3b8",
                            )
                        )

        # Also add Investigation→entity edges that the query exposes via CONTAINS.
        inv_node_id: Optional[str] = None
        if records:
            inv_raw = records[0].get("i")
            if inv_raw:
                inv_node_id = inv_raw.get("node_id")

        if inv_node_id:
            for record in records:
                n = record.get("n")
                if n and "node_id" in n:
                    src = inv_node_id
                    tgt = n["node_id"]
                    edge_key = f"{src}→CONTAINS→{tgt}"
                    if edge_key not in seen_edges:
                        seen_edges.add(edge_key)
                        edges.append(
                            GraphEdge(
                                id=str(uuid.uuid4()),
                                source=src,
                                target=tgt,
                                label="CONTAINS",
                                color="#64748b",
                            )
                        )

    except Exception as exc:
        logger.error("get_graph_data failed: %s", exc)

    return GraphResponse(nodes=list(nodes_map.values()), edges=edges)


# ──────────────────────────────────────────────────────────────────────────────
# Entity listing
# ──────────────────────────────────────────────────────────────────────────────

async def get_all_entities(skip: int = 0, limit: int = 100) -> List[Dict[str, Any]]:
    """Return a paginated list of all non-Investigation nodes in the graph."""
    if _use_fallback():
        db = _load_fallback_db()
        entities_list = list(db["entities"].values())
        # Sort by creation time descending
        entities_list.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        paginated = entities_list[skip:skip+limit]

        results = []
        for ent in paginated:
            results.append({
                "node_id": ent["node_id"],
                "node_type": ent["label"],
                "value": ent["value"],
                "platform": ent["platform"],
                "url": ent["url"],
                "confidence": ent.get("confidence", 0.95),
                "metadata": ent["metadata"],
                "created_at": ent["created_at"],
                "updated_at": ent.get("updated_at"),
            })
        return results

    cypher = """
    MATCH (e)
    WHERE NOT e:Investigation
    RETURN e, labels(e) AS labels
    ORDER BY e.created_at DESC
    SKIP $skip
    LIMIT $limit
    """
    try:
        async with get_session() as session:
            result = await session.run(cypher, {"skip": skip, "limit": limit})
            records = await result.data()

        entities = []
        for rec in records:
            node = dict(rec["e"])
            node["node_type"] = rec["labels"][0] if rec["labels"] else "Unknown"
            if isinstance(node.get("metadata"), str):
                try:
                    node["metadata"] = _json.loads(node["metadata"])
                except Exception:
                    node["metadata"] = {}
            entities.append(node)
        return entities
    except Exception as exc:
        logger.error("get_all_entities failed: %s", exc)
        return []


async def update_person_node(node_id: str, properties: Dict[str, Any]) -> bool:
    """Update properties on a Person (or any other) node by node_id.
    
    Supports both Neo4j and fallback JSON.
    """
    if _use_fallback():
        db = _load_fallback_db()
        entity = db["entities"].get(node_id)
        if not entity:
            entity = {
                "node_id": node_id,
                "label": "Person",
                "created_at": _now().isoformat(),
            }
            db["entities"][node_id] = entity
            
        entity["value"] = properties.get("name", entity.get("value", ""))
        for key in ["email", "phone_number", "social_media_id", "picture", "links", 
                    "cdr_data", "ipdr_data", "cdr_analysis", "ipdr_analysis"]:
            if key in properties:
                entity[key] = properties[key]
        entity["updated_at"] = _now().isoformat()
        
        if "label" in properties:
            entity["label"] = properties["label"]
            
        _save_fallback_db(db)
        return True

    # Neo4j implementation
    cypher = """
    MERGE (n {node_id: $node_id})
    SET n.value = $name,
        n.email = $email,
        n.phone_number = $phone_number,
        n.social_media_id = $social_media_id,
        n.picture = $picture,
        n.links = $links,
        n.cdr_data = $cdr_data,
        n.ipdr_data = $ipdr_data,
        n.cdr_analysis = $cdr_analysis,
        n.ipdr_analysis = $ipdr_analysis,
        n.created_at = COALESCE(n.created_at, $created_at),
        n.updated_at = $updated_at
    """
    if properties.get("label") == "Person":
        cypher += "\nSET n:Person"
    elif properties.get("label"):
        label = properties["label"]
        cypher += f"\nSET n:{label}"

    params = {
        "node_id": node_id,
        "name": properties.get("name", ""),
        "email": properties.get("email"),
        "phone_number": properties.get("phone_number"),
        "social_media_id": properties.get("social_media_id"),
        "picture": properties.get("picture"),
        "links": properties.get("links"),
        "cdr_data": properties.get("cdr_data"),
        "ipdr_data": properties.get("ipdr_data"),
        "cdr_analysis": properties.get("cdr_analysis"),
        "ipdr_analysis": properties.get("ipdr_analysis"),
        "created_at": _now().isoformat(),
        "updated_at": _now().isoformat(),
    }
    
    try:
        async with get_session() as session:
            await session.run(cypher, params)
        return True
    except Exception as exc:
        logger.error("update_person_node failed: %s", exc)
        return False


async def get_all_people() -> List[Dict[str, Any]]:
    """Return all people nodes or nodes edited to contain contact info."""
    if _use_fallback():
        db = _load_fallback_db()
        people = []
        for eid, ent in db["entities"].items():
            if ent.get("label") == "Person" or "phone_number" in ent or "email" in ent or "picture" in ent:
                people.append({
                    "node_id": eid,
                    "name": ent.get("value", ""),
                    "email": ent.get("email"),
                    "phone_number": ent.get("phone_number"),
                    "social_media_id": ent.get("social_media_id"),
                    "picture": ent.get("picture"),
                    "links": ent.get("links"),
                    "cdr_data": ent.get("cdr_data"),
                    "ipdr_data": ent.get("ipdr_data"),
                    "cdr_analysis": ent.get("cdr_analysis"),
                    "ipdr_analysis": ent.get("ipdr_analysis"),
                })
        return people

    # Neo4j implementation
    cypher = """
    MATCH (p)
    WHERE p:Person OR p.phone_number IS NOT NULL OR p.email IS NOT NULL OR p.picture IS NOT NULL
    RETURN p
    """
    try:
        async with get_session() as session:
            result = await session.run(cypher)
            records = await result.data()
        people = []
        for rec in records:
            p = dict(rec["p"])
            people.append({
                "node_id": p.get("node_id"),
                "name": p.get("value", ""),
                "email": p.get("email"),
                "phone_number": p.get("phone_number"),
                "social_media_id": p.get("social_media_id"),
                "picture": p.get("picture"),
                "links": p.get("links"),
                "cdr_data": p.get("cdr_data"),
                "ipdr_data": p.get("ipdr_data"),
                "cdr_analysis": p.get("cdr_analysis"),
                "ipdr_analysis": p.get("ipdr_analysis"),
            })
        return people
    except Exception as exc:
        logger.error("get_all_people failed: %s", exc)
        return []

async def delete_node(node_id: str) -> bool:
    """Delete a node and all its relationships by node_id."""
    if _use_fallback():
        db = _load_fallback_db()
        deleted = False
        if node_id in db["entities"]:
            del db["entities"][node_id]
            deleted = True
        elif node_id in db["investigations"]:
            del db["investigations"][node_id]
            deleted = True
        
        if deleted:
            db["relationships"] = [
                r for r in db["relationships"] 
                if r["from"] != node_id and r["to"] != node_id
            ]
            _save_fallback_db(db)
            return True
        return False

    cypher = """
    MATCH (n {node_id: $node_id})
    DETACH DELETE n
    """
    try:
        async with get_session() as session:
            result = await session.run(cypher, {"node_id": node_id})
            summary = await result.consume()
            return summary.counters.nodes_deleted > 0
    except Exception as exc:
        logger.error("delete_node failed: %s", exc)
        return False

async def clear_database() -> bool:
    """Delete all nodes and relationships from the database."""
    if _use_fallback():
        db = {
            "investigations": {},
            "entities": {},
            "relationships": []
        }
        _save_fallback_db(db)
        return True

    cypher = """
    MATCH (n)
    DETACH DELETE n
    """
    try:
        async with get_session() as session:
            await session.run(cypher)
        return True
    except Exception as exc:
        logger.error("clear_database failed: %s", exc)
        return False


