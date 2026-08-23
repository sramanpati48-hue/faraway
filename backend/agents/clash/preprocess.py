"""Case preprocessing for Clash Mode."""
from backend.agents.clash.context import CLASH_EFFICIENCY_V2, case_facts, case_title
from backend.agents.clash.roles import normalize_user_role
from backend.clash_schemas import ClashPhase

# Three fast rounds — full courtroom arc without 5 slow LLM cycles
PHASES = [
    ClashPhase.opening,
    ClashPhase.rebuttal,
    ClashPhase.closing,
]


def preprocess_case_node(state: dict) -> dict:
    title = case_title(state)
    facts = case_facts(state)
    mode = state.get("mode") or "practice"
    user_role = normalize_user_role(state.get("user_role"))

    print(f"⚖️ Clash preprocess — {title[:60]} (mode={mode}, role={user_role})")

    out: dict = {
        "user_role": user_role,
        "mode": mode,
        "phase": ClashPhase.opening.value,
        "phase_index": 0,
        "round_number": 1,
        "rag_cache": {},
        "cross_exam_stage": None,
        "awaiting_user_input": False,
        "pending_question": None,
        "question_agent_side": None,
        "user_action": None,
        "ai_assist_allowed": False,
        "force_ai": False,
        "resume_node": None,
        "counsel_error": None,
        "next_step": "prosecution",
        # Reducers: do not re-emit existing lists (would duplicate). Fresh start = omit.
    }

    # Legacy path / first hydrate: keep statics on state when V2 off
    if not CLASH_EFFICIENCY_V2:
        from backend.agents.clash.constants import JUDGE_PARAMETERS

        enriched = facts.strip()
        if mode == "real_life":
            enriched = (
                f"[Real-life simulation — not legal advice]\n{enriched}\n\n"
                "The Court will evaluate arguments based solely on facts provided. "
                f"Your AI counsel represents the {user_role} side."
            )
        else:
            enriched = f"[Practice courtroom — you play {user_role}]\n{enriched}"
        out.update(
            {
                "case_facts": enriched,
                "case_title": title,
                "judge_parameters": JUDGE_PARAMETERS,
            }
        )

    return out
