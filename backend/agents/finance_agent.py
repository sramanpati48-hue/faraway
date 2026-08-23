from langchain_core.messages import SystemMessage
from backend.utils import get_llm_for_task
from backend.agents.common_utils import get_user_location_context
from backend.agents.specialist_runner import run_specialist

llm = get_llm_for_task("chat_agent.finance")


def finance_agent(state):
    print("\n💹 FINANCE AGENT ACTIVATED")
    user_details = state.get("user_details") or {}
    location_data = state.get("location") or user_details.get("location")
    city, state_name, loc_str = get_user_location_context(location_data)
    extra = f"USER LOCATION: {loc_str} ({city}, {state_name})"
    full = """
Cover loans, cheque bounce (NI Act), banking/RBI complaints, recovery agents, and consumer finance.
Lead with the correct forum (bank grievance, ombudsman, police if cheating, civil recovery) without inventing sections.
"""
    out = run_specialist(
        state,
        llm=llm,
        role_name="Finance / Banking Law Agent",
        extra_context=extra,
        full_instructions=full,
    )
    out["case_category"] = state.get("case_category") or "finance"
    return out
