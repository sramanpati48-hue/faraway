from backend.utils import get_llm_for_task
from backend.agents.specialist_runner import run_specialist

llm = get_llm_for_task("chat_agent.domestic")


def domestic_agent(state):
    print("\n🏠 DOMESTIC AGENT ACTIVATED")
    full = """
Guidance on domestic violence, dowry, workplace harassment in a family context.
Safety first (112 / 181). PWDVA / BNSS procedure from retrieved context only.
"""
    out = run_specialist(state, llm=llm, role_name="Domestic Violence Agent", full_instructions=full)
    out["case_category"] = state.get("case_category") or "domestic"
    return out
