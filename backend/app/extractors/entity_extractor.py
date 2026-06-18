"""
extractors/entity_extractor.py – NLP-based and regex-based entity extraction.

This module provides :func:`extract_entities`, which accepts arbitrary free-form
text and returns a list of detected entities suitable for creating Neo4j nodes.

Two complementary methods are used:
1. **spaCy NER** – trained model detects PERSON, ORG, GPE, URL labels.
2. **Regex patterns** – catch emails, phone numbers, and URLs that NER misses.

Results from both methods are deduplicated before being returned.

If the spaCy model (``en_core_web_sm``) is not installed, the function falls
back to regex-only mode and logs a warning.
"""

from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Compiled regex patterns ────────────────────────────────────────────────────

_EMAIL_PATTERN = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)
_PHONE_PATTERN = re.compile(
    r"[\+]?[1-9][0-9 .\-\(\)]{8,15}"
)
_URL_PATTERN = re.compile(
    r"https?://[^\s\"'<>]+"
)

# Mapping from spaCy NER label → our entity_type string.
_SPACY_LABEL_MAP: Dict[str, str] = {
    "PERSON": "Person",
    "ORG": "Organization",
    "GPE": "Location",
    "LOC": "Location",
    "URL": "Website",
}

# Module-level cache for the spaCy model so we only load it once.
_nlp = None
_nlp_load_attempted = False


def _get_nlp():
    """Lazily load and cache the spaCy model.

    Returns ``None`` if the model is unavailable, and logs a warning the first
    time this happens.
    """
    global _nlp, _nlp_load_attempted
    if _nlp_load_attempted:
        return _nlp
    _nlp_load_attempted = True
    try:
        import spacy  # type: ignore
        _nlp = spacy.load("en_core_web_sm")
        logger.info("spaCy model 'en_core_web_sm' loaded successfully.")
    except OSError:
        logger.warning(
            "spaCy model 'en_core_web_sm' not found.  "
            "Run: python -m spacy download en_core_web_sm\n"
            "Falling back to regex-only entity extraction."
        )
        _nlp = None
    except ImportError:
        logger.warning("spaCy is not installed.  Regex-only entity extraction active.")
        _nlp = None
    return _nlp


def extract_entities(text: str) -> List[Dict]:
    """Extract named entities from free-form ``text``.

    Combines spaCy NER output with regex-based detection and deduplicates
    results by ``(entity_type, value)`` pair.

    Args:
        text: Any free-form text string (e.g. HTML snippets, document content).

    Returns:
        A list of dicts with keys:
        - ``entity_type``  (str): One of Person, Organization, Location,
          Website, Email, PhoneNumber.
        - ``value``        (str): The extracted text value.
        - ``confidence``   (float): Estimated confidence in the extraction.
        - ``method``       (str): ``"ner"`` or ``"regex"``.
    """
    if not text or not text.strip():
        return []

    entities: List[Dict] = []
    seen: set = set()  # (entity_type, normalised_value) pairs already added.

    def _add(entity_type: str, value: str, confidence: float, method: str) -> None:
        """Add an entity if it has not already been seen."""
        key = (entity_type, value.lower().strip())
        if key not in seen and value.strip():
            seen.add(key)
            entities.append(
                {
                    "entity_type": entity_type,
                    "value": value.strip(),
                    "confidence": confidence,
                    "method": method,
                }
            )

    # ── 1. spaCy NER ──────────────────────────────────────────────────────
    nlp = _get_nlp()
    if nlp is not None:
        try:
            # Truncate very long texts to avoid memory issues.
            doc = nlp(text[:50_000])
            for ent in doc.ents:
                entity_type = _SPACY_LABEL_MAP.get(ent.label_)
                if entity_type:
                    _add(entity_type, ent.text, 0.75, "ner")
        except Exception as exc:
            logger.warning("spaCy NER processing error: %s", exc)

    # ── 2. Regex extraction ───────────────────────────────────────────────
    for match in _EMAIL_PATTERN.finditer(text):
        _add("Email", match.group(), 0.85, "regex")

    for match in _URL_PATTERN.finditer(text):
        url = match.group().rstrip(".,;)")  # Clean trailing punctuation.
        _add("Website", url, 0.70, "regex")

    for match in _PHONE_PATTERN.finditer(text):
        candidate = match.group().strip()
        # Rough filter: must contain at least 7 digits to be a phone number.
        digit_count = sum(c.isdigit() for c in candidate)
        if digit_count >= 7:
            _add("PhoneNumber", candidate, 0.60, "regex")

    logger.debug("extract_entities: found %d entities in text.", len(entities))
    return entities
