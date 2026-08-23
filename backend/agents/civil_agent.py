from backend.utils import get_llm_for_task
from backend.agents.specialist_runner import run_specialist

llm = get_llm_for_task("chat_agent.civil")


def civil_agent(state):
    print("\n⚖️ CIVIL AGENT ACTIVATED")
    full = """
Suggest next steps for civil matters (property, tenancy, consumer, contracts, family/divorce that are not criminal).
Do not handle missing-person or police FIR criminal matters.
"""
    out = run_specialist(state, llm=llm, role_name="Civil Law Agent", full_instructions=full)
    out["case_category"] = state.get("case_category") or "civil"
    return out
