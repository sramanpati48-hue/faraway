from backend.utils import get_llm_for_task
from backend.agents.common_utils import get_local_scam_summary, get_user_location_context
from backend.agents.specialist_runner import run_specialist

llm = get_llm_for_task("chat_agent.cyber")


def cyber_agent(state):
    print("\n🔐 CYBER AGENT ACTIVATED")
    user_details = state.get("user_details") or {}
    location_data = state.get("location") or user_details.get("location")
    city, state_name, loc_str = get_user_location_context(location_data)
    local_scam_context = get_local_scam_summary(city)
    extra = f"USER LOCATION: {loc_str}\nLOCAL SCAM ALERTS:\n{local_scam_context}"
    full = f"""
If financial loss occurred, call 1930 and file at cybercrime.gov.in.
Mention Cyber Crime Cell in {city} when location is known.
"""
    out = run_specialist(
        state,
        llm=llm,
        role_name="Cyber Crime Agent",
        extra_context=extra,
        full_instructions=full,
    )
    out["case_category"] = state.get("case_category") or "cyber"
    return out
