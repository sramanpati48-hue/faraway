from backend.utils import get_llm_for_task
from backend.agents.common_utils import get_user_location_context
from backend.agents.specialist_runner import run_specialist

llm = get_llm_for_task("chat_agent.criminal")


def criminal_agent(state):
    print("\n🚨 CRIMINAL AGENT ACTIVATED")
    user_details = state.get("user_details") or {}
    location_data = state.get("location") or user_details.get("location")
    city, state_name, loc_str = get_user_location_context(location_data)
    extra = f"USER LOCATION: {loc_str}"
    full = f"""
POLICE / SAFETY FIRST. Lead with 112 / local police / missing-person report / FIR.
Location context: {city}, {state_name}.
Do NOT lead with hire a lawyer. Structure: Immediate action, police process, legal sections from context, what to prepare.
"""
    out = run_specialist(
        state,
        llm=llm,
        role_name="Criminal Law Agent",
        extra_context=extra,
        full_instructions=full,
    )
    out["case_category"] = state.get("case_category") or "criminal"
    return out
