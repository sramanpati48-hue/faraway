"""Merge user answer / argue / ask / delegate and clear pause flags (legacy V2=0 path)."""
from backend.agents.clash.roles import normalize_user_role
from backend.agents.clash.utils import (
    asked_questions_delta,
    build_logic_entries,
    new_question_id,
    tag_follow_up_for_side,
)


def incorporate_user_answer_node(state: dict) -> dict:
    answer = (state.get("resumed_answer") or "").strip()
    delegate = bool(state.get("resumed_delegate"))
    question = state.get("pending_question") or ""
    qid = state.get("pending_question_id") or ""
    side = state.get("question_agent_side") or "system"
    user_action = state.get("user_action") or "answer"
    user_role = normalize_user_role(state.get("user_role"))
    resume = state.get("resume_node") or "prosecution"
    phase = state.get("phase") or "opening"

    print(
        f"⚖️ Incorporate — action={user_action} delegate={delegate} "
        f"resume={resume} role={user_role}"
    )

    if delegate:
        force_target = resume
        out = {
            "resumed_answer": None,
            "resumed_delegate": None,
            "awaiting_user_input": False,
            "force_ai": True,
            "user_action": None,
            "ai_assist_allowed": False,
            "pending_question": state.get("pending_question"),
            "pending_question_id": state.get("pending_question_id"),
            "question_agent_side": state.get("question_agent_side"),
            "question_target": state.get("question_target"),
            "answering_side": state.get("answering_side"),
            "cross_exam_stage": state.get("cross_exam_stage"),
        }
        if user_action == "argue":
            out["next_step"] = "prosecution" if resume == "prosecution" else "defence"
            out["pending_question"] = None
            out["pending_question_id"] = None
        elif user_action == "ask":
            out["next_step"] = "cross_exam"
            out["pending_question"] = None
            out["pending_question_id"] = None
        elif user_action == "answer":
            target = state.get("answering_side") or state.get("question_target") or user_role
            out["answering_side"] = (
                target if target in ("prosecution", "defence") else user_role
            )
            out["next_step"] = "ai_cross_answer"
        else:
            out["next_step"] = force_target if force_target != "wait_user" else "prosecution"
        return out

    if user_action == "argue":
        if resume in ("prosecution", "defence"):
            argue_side = resume
        else:
            argue_side = user_role

        out = {
            "transcript_entries": [
                {
                    "side": argue_side,
                    "phase": phase,
                    "kind": "argument",
                    "content": answer,
                    "law_sections": [],
                    "from_user": True,
                }
            ],
            "logic_log": build_logic_entries(
                side=argue_side,
                phase=phase,
                reasoning_steps=[f"{argue_side.capitalize()}: (user submission)"],
                law_sections=[],
                argument=answer,
            ),
            "resumed_answer": None,
            "resumed_delegate": None,
            "awaiting_user_input": False,
            "pending_question": None,
            "pending_question_id": None,
            "user_action": None,
            "ai_assist_allowed": False,
            "force_ai": False,
            "user_provided_argument_side": argue_side,
        }
        if argue_side == "prosecution":
            out["prosecution_output"] = answer
            out["next_step"] = "defence"
        else:
            out["defence_output"] = answer
            out["next_step"] = "cross_exam"
        return out

    if user_action == "ask":
        asker = user_role
        stage = state.get("cross_exam_stage") or "p_ask"
        if stage == "p_ask":
            asker = "prosecution"
        elif stage == "d_ask":
            asker = "defence"
        tagged = tag_follow_up_for_side(asker, answer)
        return {
            "user_provided_question": tagged,
            "pending_question_id": qid or new_question_id(),
            "resumed_answer": None,
            "resumed_delegate": None,
            "awaiting_user_input": False,
            "user_action": None,
            "ai_assist_allowed": False,
            "force_ai": False,
            "cross_exam_stage": stage,
            "next_step": "cross_exam",
        }

    user_answers = [
        {
            "question_id": qid,
            "question": question,
            "answer": answer,
            "agent_side": side,
            "phase": phase,
            "target": state.get("question_target") or user_role,
        }
    ]
    asked_delta = asked_questions_delta(list(state.get("asked_questions") or []), question)

    if (state.get("cross_exam_stage") or resume == "cross_exam") and state.get(
        "cross_exam_stage"
    ) in ("d_answer", "p_answer", "p_ask", "d_ask"):
        return {
            "user_provided_answer": answer,
            "user_answers": user_answers,
            "asked_questions": asked_delta,
            "resumed_answer": None,
            "resumed_delegate": None,
            "awaiting_user_input": False,
            "user_action": None,
            "ai_assist_allowed": False,
            "force_ai": False,
            "next_step": "cross_exam",
        }

    return {
        "user_answers": user_answers,
        "asked_questions": asked_delta,
        "transcript_entries": [
            {
                "side": "user",
                "phase": phase,
                "content": answer,
                "kind": "user_answer",
                "question_id": qid,
                "asked_by": side,
            }
        ],
        "resumed_answer": None,
        "resumed_delegate": None,
        "awaiting_user_input": False,
        "pending_question": None,
        "pending_question_id": None,
        "user_action": None,
        "ai_assist_allowed": False,
        "force_ai": False,
        "next_step": resume if resume and resume != "wait_user" else "prosecution",
    }
