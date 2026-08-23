"""RAG retrieval for Clash Mode agents against public.legal_documents."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from backend.agents.clash.context import case_facts, fact_fingerprint, get_config_dict, mock_case_id
from backend.agents.common_utils import retrieve_legal_context
from backend.services.rag_retrieval_config import get_rag_retrieval_settings

CLASH_RAG_TOP_K = 5


def _short_title(title: str, max_len: int = 48) -> str:
    """Keep citation chips readable — DB titles are often full section text."""
    t = " ".join((title or "").split())
    if not t:
        return ""
    if len(t) <= max_len:
        return t
    cut = t[:max_len].rsplit(" ", 1)[0]
    return (cut or t[:max_len]).rstrip(".,;:—-") + "…"


def shorten_law_label(label: str, max_len: int = 72) -> str:
    s = " ".join(str(label or "").split())
    if len(s) <= max_len:
        return s
    cut = s[:max_len].rsplit(" ", 1)[0]
    return (cut or s[:max_len]).rstrip(".,;:—-") + "…"


def _citation_from_row(row: dict) -> Dict[str, Any]:
    act = str(row.get("act_name") or "").strip()
    section = str(row.get("section_number") or "").strip()
    title = str(row.get("title") or "").strip()
    if act and section:
        label = f"{act} — s.{section}"
    else:
        label_parts = [p for p in (act, f"s.{section}" if section else "", _short_title(title)) if p]
        label = " — ".join(label_parts) if label_parts else "Legal authority"
    return {
        "act_name": act or None,
        "section_number": section or None,
        "title": title or None,
        "label": shorten_law_label(label),
        "similarity": row.get("similarity"),
        "id": row.get("id"),
    }


def build_rag_query(
    *,
    case_facts: str,
    phase: str,
    side: str,
    opposing_argument: str = "",
    extra: str = "",
) -> str:
    """Build a retrieval query from case facts, phase, and latest opposing argument."""
    parts = [
        f"Indian law relevant to {side} counsel in {phase.replace('_', ' ')} phase",
        (case_facts or "")[:900],
    ]
    if opposing_argument:
        parts.append(f"Responding to: {opposing_argument[:400]}")
    if extra:
        parts.append(extra[:300])
    return "\n".join(p for p in parts if p and p.strip())


def retrieve_law_context(
    query: str,
    *,
    top_k: int | None = None,
    filter_category: Optional[str] = None,
) -> Dict[str, Any]:
    """Retrieve Indian-law chunks and return prompt text + citation list."""
    settings = get_rag_retrieval_settings("clash_agent")
    resolved_top_k = int(top_k) if top_k is not None else int(settings["top_k"])
    try:
        context_text, rows = retrieve_legal_context(
            query,
            top_k=resolved_top_k,
            filter_category=filter_category,
            graph_id="clash_agent",
            min_similarity=float(settings["min_similarity"]),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ Clash RAG retrieval failed: {exc}")
        return {"context_text": "", "citations": [], "rows": []}

    citations = [_citation_from_row(r) for r in (rows or []) if isinstance(r, dict)]
    return {
        "context_text": context_text or "",
        "citations": citations,
        "rows": rows or [],
    }


def format_rag_prompt_block(context_text: str, *, side: str = "counsel") -> str:
    """Inject retrieved authorities into an agent system prompt."""
    if not (context_text or "").strip():
        return (
            "=== INDIAN LAW ON RECORD (retrieved) ===\n"
            "No matching statutes were retrieved. Do not invent section numbers; "
            "argue from general principles and the facts on record.\n"
        )
    return f"""=== INDIAN LAW ON RECORD (retrieved from legal_documents) ===
{context_text}

RAG CITATION RULES for {side}:
- Prefer citing ONLY acts/sections that appear in the retrieved context above.
- Put those citations in law_sections (short labels like "NI Act s.138").
- If the retrieved context does not cover a point, say so briefly — do not invent sections.
"""


def rag_cache_key(state: dict, *, side: str, phase: str) -> str:
    cfg = get_config_dict()
    case_key = str(
        mock_case_id(state)
        or cfg.get("mock_case_id")
        or cfg.get("session_id")
        or state.get("session_id")
        or "case"
    )
    fp = cfg.get("fact_fingerprint") or fact_fingerprint(case_facts(state))
    settings = get_rag_retrieval_settings("clash_agent")
    thresh = f"k{settings['top_k']}-s{settings['min_similarity']}"
    return f"{case_key}|{fp}|{phase}|{side}|{thresh}"


def get_cached_or_retrieve(
    state: dict,
    *,
    side: str,
    phase: str,
    query: str,
) -> Tuple[str, List[Dict[str, Any]], Dict[str, Any]]:
    """Return (context_text, citations, rag_cache_update) with hashed cache keys."""
    cache = dict(state.get("rag_cache") or {})
    key = rag_cache_key(state, side=side, phase=phase)
    legacy_key = f"{phase}:{side}"
    cached = cache.get(key) or cache.get(legacy_key)
    if isinstance(cached, dict) and cached.get("context_text") is not None:
        return (
            str(cached.get("context_text") or ""),
            list(cached.get("citations") or []),
            {},
        )

    result = retrieve_law_context(query)
    cache[key] = {
        "context_text": result["context_text"],
        "citations": result["citations"],
    }
    return result["context_text"], result["citations"], {"rag_cache": cache}


def citation_labels(citations: List[Dict[str, Any]]) -> List[str]:
    labels: List[str] = []
    for c in citations or []:
        if not isinstance(c, dict):
            continue
        act = str(c.get("act_name") or "").strip()
        section = str(c.get("section_number") or "").strip()
        if act and section:
            label = f"{act} — s.{section}"
        else:
            label = c.get("label") or act or _short_title(str(c.get("title") or ""))
        label = shorten_law_label(str(label or ""))
        if label and label not in labels:
            labels.append(label)
    return labels


def purge_pending_rag() -> Dict[str, Any]:
    """Clear ephemeral citation / reasoning blobs from state after stream emit."""
    return {
        "pending_rag_citations": None,
        "pending_law_sections": None,
        "pending_reasoning_steps": None,
    }
