from backend.utils import get_llm_for_task
from backend.database import supabase_db
from backend.agents.common_utils import get_local_scam_summary, get_user_location_context
from backend.agents.scam_match import match_case_to_mock_scams
from backend.agents.specialist_runner import run_specialist

llm = get_llm_for_task("chat_agent.scam")


def scam_agent(state):
    print("\n🚫 SCAM AGENT ACTIVATED")
    user_details = state.get("user_details") or {}
    location_data = state.get("location") or user_details.get("location")
    city, _state_name, loc_str = get_user_location_context(location_data)
    local_scam_context = get_local_scam_summary(city)
    matched = match_case_to_mock_scams(state)
    similar_trends = matched.get("matches") or []
    similar_trend_context = matched.get("note") or "No highly similar local scam trend found from user reports."
    if similar_trends and not matched.get("note"):
        lines = []
        for trend in similar_trends:
            title = trend.get("title") or trend.get("scam_type") or "Scam alert"
            t_city = trend.get("city") or city
            similarity = trend.get("similarity", 0)
            lines.append(f"- {title} ({t_city}) [similarity={similarity}]")
        similar_trend_context = "\n".join(lines)
    extra = (
        f"USER LOCATION: {loc_str}\nLOCAL SCAM TRENDS IN {city}:\n{local_scam_context}\n"
        f"SIMILAR USER-REPORTED TRENDS:\n{similar_trend_context}"
    )
    full = "Protective measures first. If money is already lost, treat as cyber-fraud and send to 1930 / cybercrime.gov.in."
    out = run_specialist(state, llm=llm, role_name="Scam Analysis Agent", extra_context=extra, full_instructions=full)
    out["matched_scam_trends"] = similar_trends
    out["scam_similarity_note"] = matched.get("note") or similar_trend_context
    out["scam_match_done"] = True
    out["case_category"] = state.get("case_category") or "scam"
    return out
