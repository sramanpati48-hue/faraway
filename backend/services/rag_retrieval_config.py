"""Per-graph legal RAG retrieval thresholds (top_k + min_similarity).

Stored in ``system_config`` under key ``rag_retrieval``. Separate from the RAG
funnel ingest settings (``rag_funnel``).

The same key also holds ``scam_match`` cosine thresholds used by the silent
``scam_match`` graph node against ``mock_scams`` (Admin → RAG retrieval).
That is distinct from ``scam_classifier.similarity_threshold`` (case clustering).
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from backend.services import admin_models

RAG_RETRIEVAL_CONFIG_KEY = "rag_retrieval"
SCAM_MATCH_STORED_KEY = "scam_match"

# Match historical hardcoded defaults
DEFAULT_CHAT_TOP_K = 10
DEFAULT_CLASH_TOP_K = 5
TOP_K_MIN = 1
TOP_K_MAX = 30

GRAPH_IDS = ("chat_agent", "clash_agent")

GRAPH_LABELS = {
    "chat_agent": "Chat agent",
    "clash_agent": "Clash agent",
}

# Live mock_scams match (scam_match node) — previous hardcoded values
DEFAULT_SCAM_CITY_MIN_SIMILARITY = 0.78
DEFAULT_SCAM_NATIONAL_MIN_SIMILARITY = 0.82
DEFAULT_SCAM_TOP_K = 5


def default_rag_retrieval_config() -> dict[str, Any]:
    return {
        "chat_agent": {"top_k": DEFAULT_CHAT_TOP_K, "min_similarity": 0.0},
        "clash_agent": {"top_k": DEFAULT_CLASH_TOP_K, "min_similarity": 0.0},
    }


def _clamp_top_k(value: Any, fallback: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(TOP_K_MIN, min(TOP_K_MAX, n))


def _clamp_min_similarity(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    if n <= 0:
        return 0.0
    return max(0.0, min(1.0, n))


def _normalize_graph_settings(raw: Any, *, default_top_k: int) -> dict[str, Any]:
    base = {"top_k": default_top_k, "min_similarity": 0.0}
    if not isinstance(raw, dict):
        return base
    return {
        "top_k": _clamp_top_k(raw.get("top_k"), default_top_k),
        "min_similarity": _clamp_min_similarity(raw.get("min_similarity")),
    }


def default_scam_match_config() -> dict[str, Any]:
    return {
        "city_min_similarity": DEFAULT_SCAM_CITY_MIN_SIMILARITY,
        "national_min_similarity": DEFAULT_SCAM_NATIONAL_MIN_SIMILARITY,
        "top_k": DEFAULT_SCAM_TOP_K,
    }


def _clamp_scam_similarity(value: Any, fallback: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(0.0, min(1.0, n))


def _normalize_scam_match_settings(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return deepcopy(default_scam_match_config())
    return {
        "city_min_similarity": _clamp_scam_similarity(
            raw.get("city_min_similarity"), DEFAULT_SCAM_CITY_MIN_SIMILARITY
        ),
        "national_min_similarity": _clamp_scam_similarity(
            raw.get("national_min_similarity"), DEFAULT_SCAM_NATIONAL_MIN_SIMILARITY
        ),
        "top_k": _clamp_top_k(raw.get("top_k"), DEFAULT_SCAM_TOP_K),
    }


def _stored_blob() -> dict[str, Any]:
    stored = admin_models.read_config_key(RAG_RETRIEVAL_CONFIG_KEY, {})
    return stored if isinstance(stored, dict) else {}


def get_rag_retrieval_config() -> dict[str, Any]:
    """Defaults merged with stored system_config (clamped)."""
    defaults = default_rag_retrieval_config()
    stored = _stored_blob()
    out: dict[str, Any] = {}
    for gid in GRAPH_IDS:
        default_top = int(defaults[gid]["top_k"])
        out[gid] = _normalize_graph_settings(stored.get(gid), default_top_k=default_top)
    return out


def get_scam_match_config() -> dict[str, Any]:
    """Live mock_scams cosine thresholds for the scam_match node."""
    stored = _stored_blob()
    return _normalize_scam_match_settings(stored.get(SCAM_MATCH_STORED_KEY))


def get_scam_match_settings() -> dict[str, Any]:
    return deepcopy(get_scam_match_config())


def get_rag_retrieval_settings(graph_id: str) -> dict[str, Any]:
    """Resolve ``{top_k, min_similarity}`` for a graph id."""
    cfg = get_rag_retrieval_config()
    gid = (graph_id or "chat_agent").strip()
    if gid not in cfg:
        gid = "chat_agent"
    return deepcopy(cfg[gid])


def save_rag_retrieval_config(body: dict[str, Any]) -> dict[str, Any]:
    """Validate, persist graphs + scam_match, and return graph config."""
    defaults = default_rag_retrieval_config()
    current = get_rag_retrieval_config()
    if not isinstance(body, dict):
        raise ValueError("Body must be a JSON object")
    merged = deepcopy(current)
    for gid in GRAPH_IDS:
        if gid not in body:
            continue
        default_top = int(defaults[gid]["top_k"])
        merged[gid] = _normalize_graph_settings(body.get(gid), default_top_k=default_top)
    if SCAM_MATCH_STORED_KEY in body:
        scam = _normalize_scam_match_settings(body.get(SCAM_MATCH_STORED_KEY))
    else:
        scam = get_scam_match_config()
    to_store = deepcopy(merged)
    to_store[SCAM_MATCH_STORED_KEY] = scam
    admin_models.write_config_key(RAG_RETRIEVAL_CONFIG_KEY, to_store)
    return get_rag_retrieval_config()


def rag_retrieval_admin_snapshot() -> dict[str, Any]:
    return {
        "config": get_rag_retrieval_config(),
        "defaults": default_rag_retrieval_config(),
        "graphs": [{"id": gid, "label": GRAPH_LABELS.get(gid, gid)} for gid in GRAPH_IDS],
        "limits": {"top_k_min": TOP_K_MIN, "top_k_max": TOP_K_MAX},
        "scam_match": get_scam_match_config(),
        "scam_match_defaults": default_scam_match_config(),
    }


def filter_rows_by_similarity(
    rows: list | None,
    min_similarity: float,
) -> list:
    """Drop rows below min_similarity when threshold > 0. Rows without a score are kept."""
    if not rows or not min_similarity or min_similarity <= 0:
        return list(rows or [])
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        sim = row.get("similarity")
        if sim is None:
            out.append(row)
            continue
        try:
            if float(sim) >= float(min_similarity):
                out.append(row)
        except (TypeError, ValueError):
            out.append(row)
    return out
