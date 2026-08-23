"""User-pause helpers for Clash Mode (interrupt path + legacy END path)."""
from __future__ import annotations

from typing import Any, Optional

from backend.agents.clash.context import CLASH_EFFICIENCY_V2
from backend.agents.clash.roles import ai_assist_allowed
from backend.agents.clash.utils import new_question_id


def parse_resume_value(resume: Any) -> tuple[str, bool]:
    """Normalize Command(resume=...) payload → (answer, delegate)."""
    if resume is None:
        return "", False
    if isinstance(resume, dict):
        delegate = bool(
            resume.get("delegate")
            or resume.get("resumed_delegate")
            or resume.get("__delegate__")
        )
        answer = str(
            resume.get("answer")
            or resume.get("resumed_answer")
            or resume.get("text")
            or resume.get("message")
            or ""
        ).strip()
        return answer, delegate
    text = str(resume).strip()
    if text in ("__delegate__", "[delegate]"):
        return "", True
    return text, False


def build_interrupt_payload(
    state: dict,
    *,
    prompt: str,
    question_agent_side: str,
    question_target: str,
    user_action: str,
    resume_node: str,
    answering_side: Optional[str] = None,
    pending_law_sections: Optional[list] = None,
    pending_reasoning_steps: Optional[list] = None,
    question_id: Optional[str] = None,
    extra: Optional[dict] = None,
) -> dict[str, Any]:
    qid = question_id or new_question_id()
    payload: dict[str, Any] = {
        "awaiting_user_input": True,
        "pending_question": prompt,
        "pending_question_id": qid,
        "question_agent_side": question_agent_side,
        "question_target": question_target,
        "answering_side": answering_side,
        "user_action": user_action,
        "ai_assist_allowed": ai_assist_allowed(state),
        "resume_node": resume_node,
        "pending_law_sections": list(pending_law_sections or []),
        "pending_reasoning_steps": list(pending_reasoning_steps or []),
        "phase": state.get("phase"),
        "cross_exam_stage": state.get("cross_exam_stage"),
    }
    if extra:
        payload.update(extra)
    return payload


def pause_or_interrupt(
    state: dict,
    *,
    prompt: str,
    question_agent_side: str,
    question_target: str,
    user_action: str,
    resume_node: str,
    answering_side: Optional[str] = None,
    pending_law_sections: Optional[list] = None,
    pending_reasoning_steps: Optional[list] = None,
    question_id: Optional[str] = None,
    extra: Optional[dict] = None,
) -> tuple[Optional[dict], Optional[tuple[str, bool]]]:
    """Pause for user input.

    Returns:
      - (legacy_state_update, None) when CLASH_EFFICIENCY_V2 is off
      - (None, (answer, delegate)) when V2 interrupt resumes
      - Does not return on first V2 call — raises GraphInterrupt via interrupt()
    """
    payload = build_interrupt_payload(
        state,
        prompt=prompt,
        question_agent_side=question_agent_side,
        question_target=question_target,
        user_action=user_action,
        resume_node=resume_node,
        answering_side=answering_side,
        pending_law_sections=pending_law_sections,
        pending_reasoning_steps=pending_reasoning_steps,
        question_id=question_id,
        extra=extra,
    )
    if not CLASH_EFFICIENCY_V2:
        return {
            **payload,
            "force_ai": False,
            "next_step": "wait_user",
        }, None

    from langgraph.types import interrupt

    resume = interrupt(payload)
    return None, parse_resume_value(resume)


def clear_pause_flags() -> dict[str, Any]:
    return {
        "awaiting_user_input": False,
        "pending_question": None,
        "pending_question_id": None,
        "user_action": None,
        "ai_assist_allowed": False,
        "force_ai": False,
        "resume_node": None,
        "pending_law_sections": None,
        "pending_reasoning_steps": None,
    }


def interrupt_payload_from_graph_state(graph_state: Any) -> Optional[dict[str, Any]]:
    """Extract interrupt payload from LangGraph StateSnapshot / final values."""
    if graph_state is None:
        return None

    interrupts = getattr(graph_state, "interrupts", None) or ()
    for item in interrupts:
        value = getattr(item, "value", item)
        if isinstance(value, dict) and (
            value.get("pending_question") or value.get("awaiting_user_input")
        ):
            return value

    values = getattr(graph_state, "values", None)
    if isinstance(values, dict):
        raw = values.get("__interrupt__")
        if raw:
            seq = raw if isinstance(raw, (list, tuple)) else (raw,)
            for item in seq:
                value = getattr(item, "value", item)
                if isinstance(value, dict):
                    return value
                if isinstance(item, dict) and item.get("value"):
                    return item["value"] if isinstance(item["value"], dict) else item

    if isinstance(graph_state, dict):
        if graph_state.get("pending_question") and graph_state.get("awaiting_user_input"):
            return graph_state
        raw = graph_state.get("__interrupt__")
        if raw:
            seq = raw if isinstance(raw, (list, tuple)) else (raw,)
            for item in seq:
                value = getattr(item, "value", item)
                if isinstance(value, dict):
                    return value

    tasks = getattr(graph_state, "tasks", None) or ()
    for task in tasks:
        for item in getattr(task, "interrupts", None) or ():
            value = getattr(item, "value", item)
            if isinstance(value, dict):
                return value
    return None
