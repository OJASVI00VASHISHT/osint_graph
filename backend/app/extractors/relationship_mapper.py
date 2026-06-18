"""
extractors/relationship_mapper.py – Derive relationships between entities.

Given a list of ``EntityResult`` objects found in the same investigation, this
module applies a rule-based mapping to infer typed relationships between them.

The function :func:`map_relationships` returns a list of ``RelationshipSpec``
named-tuples, each describing a relationship that should be created in Neo4j.

Rules applied
-------------
| Source entity  | Target entity  | Relationship           |
|---------------|----------------|------------------------|
| Person         | Username       | USES                   |
| Person         | Email          | HAS_EMAIL              |
| Person         | PhoneNumber    | HAS_PHONE              |
| Person         | Organization   | WORKS_AT               |
| Person         | Location       | LOCATED_IN             |
| Email          | Person         | ASSOCIATED_WITH        |
| PhoneNumber    | Person         | ASSOCIATED_WITH        |
| Username       | Website        | FOUND_ON               |

Only relationships between entities that actually have ``node_id`` values
(meaning they have already been stored in Neo4j) are emitted.
"""

from __future__ import annotations

import logging
from typing import Dict, List, NamedTuple, Optional

from app.models import EntityResult

logger = logging.getLogger(__name__)


class RelationshipSpec(NamedTuple):
    """Specification for a single directed relationship to create in Neo4j."""

    from_node_id: str
    to_node_id: str
    rel_type: str
    properties: Dict = {}  # type: ignore[assignment]


def map_relationships(
    entities: List[EntityResult],
    node_id_map: Dict[str, str],  # entity value → node_id in Neo4j
) -> List[RelationshipSpec]:
    """Derive relationships between a list of discovered entities.

    Args:
        entities:    All ``EntityResult`` objects produced by the collectors.
        node_id_map: Mapping from entity ``value`` to its Neo4j ``node_id``.
                     Only entities present in this map will be linked.

    Returns:
        A deduplicated list of :class:`RelationshipSpec` tuples.
    """
    # Group entities by type for easy cross-product matching.
    by_type: Dict[str, List[EntityResult]] = {}
    for e in entities:
        by_type.setdefault(e.entity_type, []).append(e)

    specs: List[RelationshipSpec] = []
    seen: set = set()

    def _add(
        from_entity: EntityResult,
        to_entity: EntityResult,
        rel_type: str,
    ) -> None:
        """Emit a relationship spec if both nodes exist in Neo4j."""
        from_id: Optional[str] = node_id_map.get(from_entity.value)
        to_id: Optional[str] = node_id_map.get(to_entity.value)
        if not from_id or not to_id:
            return
        key = (from_id, rel_type, to_id)
        if key in seen:
            return
        seen.add(key)
        specs.append(
            RelationshipSpec(
                from_node_id=from_id,
                to_node_id=to_id,
                rel_type=rel_type,
            )
        )

    persons = by_type.get("Person", [])
    usernames = by_type.get("Username", [])
    emails = by_type.get("Email", [])
    phones = by_type.get("PhoneNumber", [])
    organizations = by_type.get("Organization", [])
    locations = by_type.get("Location", [])
    websites = by_type.get("Website", [])

    # ── Person × Username → USES ───────────────────────────────────────────
    for person in persons:
        for username in usernames:
            _add(person, username, "USES")

    # ── Person × Email → HAS_EMAIL ────────────────────────────────────────
    for person in persons:
        for email in emails:
            _add(person, email, "HAS_EMAIL")

    # ── Person × Phone → HAS_PHONE ────────────────────────────────────────
    for person in persons:
        for phone in phones:
            _add(person, phone, "HAS_PHONE")

    # ── Person × Organization → WORKS_AT ──────────────────────────────────
    for person in persons:
        for org in organizations:
            _add(person, org, "WORKS_AT")

    # ── Person × Location → LOCATED_IN ────────────────────────────────────
    for person in persons:
        for loc in locations:
            _add(person, loc, "LOCATED_IN")

    # ── Email → Person (ASSOCIATED_WITH) ──────────────────────────────────
    for email in emails:
        for person in persons:
            _add(email, person, "ASSOCIATED_WITH")

    # ── PhoneNumber → Person (ASSOCIATED_WITH) ────────────────────────────
    for phone in phones:
        for person in persons:
            _add(phone, person, "ASSOCIATED_WITH")

    # ── Username → Website (FOUND_ON) ─────────────────────────────────────
    # A username entity with a ``platform`` that matches a Website entity.
    for username in usernames:
        if username.url:
            for website in websites:
                if website.value == username.url or (
                    username.platform and username.platform.lower() in website.value.lower()
                ):
                    _add(username, website, "FOUND_ON")

    logger.info(
        "map_relationships: derived %d relationships from %d entities.",
        len(specs),
        len(entities),
    )
    return specs
