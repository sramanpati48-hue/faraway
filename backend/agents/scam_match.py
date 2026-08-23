"""Always-on mock_scams vector match for every Cases graph run.

Silent graph node (`scam_match`): embed the user's problem, retrieve similar
rows from `mock_scams`, ask a small LLM which hits are the same modus operandi,
then stash matches on graph state for suggestions + the stored case report.

The domain `scam` specialist still runs when the supervisor routes to scam;
this node runs for *every* category so civil/criminal/cyber cases can also
flag area trends.
"""
from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from backend.agents.common_utils import extract_search_query, get_user_location_context
from backend.database import supabase_db
from backend.services.rag_retrieval_config import get_scam_match_settings
from backend.utils import get_llm_for_task


def _query_text(state: dict) -> str:
    messages = state.get("messages") or []
    last = ""
    if messages:
        last = extract_search_query(getattr(messages[-1], "content", messages[-1]))
    statement = str(state.get("user_statement") or "").strip()
    return statement or str(last or "").strip()


def compact_scam_match(row: dict[str, Any]) -> dict[str, Any]:
    sim = row.get("similarity")
    try:
        sim_f = round(float(sim), 4) if sim is not None else None
    except (TypeError, ValueError):
        sim_f = None
    desc = str(row.get("description") or "")
    return {
        "id": str(row.get("id") or ""),
        "title": str(row.get("title") or row.get("scam_type") or "Scam alert"),
        "scam_type": str(row.get("scam_type") or ""),
        "city": str(row.get("city") or ""),
        "risk_level": str(row.get("risk_level") or ""),
        "similarity": sim_f,
        "description": desc[:400],
        "lat": row.get("lat"),
        "lon": row.get("lon"),
        "llm_confirmed": bool(row.get("llm_confirmed")),
    }


def retrieve_similar_mock_scams(
    query_text: str,
    city: str | None = None,
    *,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    if not query_text or not hasattr(supabase_db, "find_similar_mock_scam_trends"):
        return []
    settings = get_scam_match_settings()
    top_k = int(limit if limit is not None else settings.get("top_k") or 5)
    city_threshold = float(settings.get("city_min_similarity") or 0.78)
    national_threshold = float(settings.get("national_min_similarity") or 0.82)
    city_key = (city or "").strip()
    if city_key.lower() in {"", "unknown", "india"}:
        city_key = None
    hits = supabase_db.find_similar_mock_scam_trends(
        query_text=query_text,
        city=city_key,
        limit=top_k,
        similarity_threshold=city_threshold,
    ) or []
    if hits:
        return hits
    # National fallback when the city corpus is thin.
    return (
        supabase_db.find_similar_mock_scam_trends(
            query_text=query_text,
            city=None,
            limit=top_k,
            similarity_threshold=national_threshold,
        )
        or []
    )


def _llm_confirm_matches(query_text: str, city: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not candidates:
        return []
    numbered = []
    for i, row in enumerate(candidates[:8], start=1):
        numbered.append(
            f"{i}. id={row.get('id')} title={row.get('title') or row.get('scam_type')} "
            f"city={row.get('city')} sim={row.get('similarity')} "
            f"desc={(str(row.get('description') or '')[:280])}"
        )
    system = SystemMessage(
        content=(
            "You compare a user's legal problem to known scam/fraud trends. "
            "Keep a trend ONLY if it is the same modus operandi (same trick), not merely the same theme. "
            "Reply with ONLY JSON: "
            '{"keep_ids": ["id", ...], "area_note": "one short sentence for the victim"}.'
        )
    )
    human = HumanMessage(
        content=(
            f"USER AREA: {city or 'unknown'}\n"
            f"USER PROBLEM:\n{query_text[:1800]}\n\n"
            f"CANDIDATE TRENDS:\n" + "\n".join(numbered)
        )
    )
    try:
        llm = get_llm_for_task("chat_agent.scam")
        resp = llm.invoke([system, human])
        content = getattr(resp, "content", "") or ""
        if isinstance(content, list):
            content = " ".join(str(p.get("text") if isinstance(p, dict) else p) for p in content)
        text = str(content).strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence:
            text = fence.group(1).strip()
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return candidates
        data = json.loads(text[start : end + 1])
        keep = {str(x) for x in (data.get("keep_ids") or [])}
        note = str(data.get("area_note") or "").strip()
        kept = []
        for row in candidates:
            item = dict(row)
            if keep and str(item.get("id")) not in keep:
                continue
            item["llm_confirmed"] = True
            if note:
                item["area_note"] = note
            kept.append(item)
        return kept or []
    except Exception as exc:  # noqa: BLE001
        print(f"   ⚠️ scam match LLM skipped: {exc}")
        # Keep only strong cosine hits if the judge is unavailable.
        national = float(get_scam_match_settings().get("national_min_similarity") or 0.82)
        return [r for r in candidates if float(r.get("similarity") or 0) >= national]


def match_case_to_mock_scams(state: dict) -> dict[str, Any]:
    existing = state.get("matched_scam_trends") if isinstance(state.get("matched_scam_trends"), list) else []
    if existing and state.get("scam_match_done"):
        note = str(state.get("scam_similarity_note") or "")
        return {"matches": existing, "note": note}

    query = _query_text(state)
    loc = state.get("location") if isinstance(state.get("location"), dict) else {}
    details = state.get("user_details") if isinstance(state.get("user_details"), dict) else {}
    location_data = loc or details.get("location") or {}
    city, _state_name, loc_str = get_user_location_context(location_data)
    if not query:
        return {"matches": [], "note": ""}

    raw = retrieve_similar_mock_scams(query, city)
    confirmed = _llm_confirm_matches(query, city or loc_str, raw) if raw else []
    matches = [compact_scam_match(r) for r in confirmed]
    area = city or loc_str or "your area"
    if matches:
        titles = ", ".join(m["title"] for m in matches[:3])
        note = (
            confirmed[0].get("area_note")
            if confirmed and confirmed[0].get("area_note")
            else f"Similar scams are already being reported in {area}: {titles}."
        )
    else:
        note = ""
    print(f"   scam_match hits={len(matches)} city={city or 'national'}")
    return {"matches": matches, "note": note}


def scam_match_agent(state: dict) -> dict:
    """Silent parallel matcher — no user-facing specialist copy."""
    print("\nSCAM MATCH (all cases)")
    try:
        result = match_case_to_mock_scams(state)
        return {
            "matched_scam_trends": result["matches"],
            "scam_similarity_note": result["note"],
            "scam_match_done": True,
            "user_facing_delta": "",
        }
    except Exception as exc:  # noqa: BLE001
        print(f"   ⚠️ scam_match failed (continuing graph): {exc}")
        return {
            "matched_scam_trends": [],
            "scam_similarity_note": "",
            "scam_match_done": True,
            "user_facing_delta": "",
        }
