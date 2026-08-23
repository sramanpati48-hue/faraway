"""Shared runtime contract for user and admin Clash graph execution.

Both callers execute the same compiled ``backend.clash_graph.clash_graph``.
This module keeps their start payload, resume delta, and checkpoint config in
one place while allowing each caller to retain its own output adapter:
NDJSON streaming for users and persistent node traces for admins.
"""
from __future__ import annotations

from typing import Any, Optional

from backend.agents.clash.constants import JUDGE_PARAMETERS
from backend.agents.clash.context import (
    CLASH_EFFICIENCY_V2,
    statics_for_config,
)
from backend.agents.clash.roles import normalize_user_role
from backend.clash_graph import clash_graph


def get_clash_graph():
    """Return the single compiled Clash graph used by every execution path."""
    return clash_graph


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def normalize_clash_mode(value: Any) -> str:
    mode = str(_enum_value(value) or "practice").strip().lower()
    return mode if mode in ("practice", "real_life") else "practice"


def normalize_clash_role(value: Any) -> str:
    role = str(_enum_value(value) or "prosecution").strip().lower()
    return role if role in ("prosecution", "defence") else "prosecution"


def enrich_case_facts(facts: str, *, mode: str, user_role: str) -> str:
    enriched = (facts or "").strip()
    if mode == "real_life":
        return (
            f"[Real-life simulation — not legal advice]\n{enriched}\n\n"
            "The Court will evaluate arguments based solely on facts provided. "
            f"Your AI counsel represents the {user_role} side."
        )
    return f"[Practice courtroom — you play {user_role}]\n{enriched}"


def build_clash_start_inputs(
    *,
    mode: Any,
    user_role: Any,
    case_title: Any,
    case_facts: Any,
    mock_case_id: Any = None,
    session_id: str,
    user_id: Optional[str],
    query_fallback: str = "",
    base_state: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build the canonical fresh-run state for the Clash graph."""
    facts_raw = str(case_facts or query_fallback or "").strip()
    if len(facts_raw) < 10:
        raise ValueError(
            "Clash Mode needs case facts (at least 10 characters). "
            "Provide case_title, case_facts, mode, and user_role."
        )

    mode_n = normalize_clash_mode(mode)
    role_n = normalize_clash_role(user_role)
    title = str(case_title or "").strip() or "Matter"
    facts = enrich_case_facts(facts_raw, mode=mode_n, user_role=role_n)

    state = dict(base_state or {})
    state.update(
        {
            "mode": mode_n,
            "user_role": role_n,
            "session_id": str(session_id),
            "user_id": str(user_id or "admin-test"),
            # Keep statics on initial state for preprocess / V2=0 / session mirrors;
            # nodes prefer configurable via context helpers.
            "case_title": title,
            "case_facts": facts,
            "mock_case_id": mock_case_id,
            "judge_parameters": JUDGE_PARAMETERS,
        }
    )
    state.pop("query", None)
    state.pop("user_message", None)
    return state


def build_clash_resume_inputs(
    *,
    answer: Optional[str],
    delegate: bool = False,
) -> dict[str, Any]:
    """Build the canonical checkpoint-resume delta for the Clash graph.

    V2: callers should prefer ``build_clash_resume_command`` (interrupt resume).
    Legacy: resumed_answer / resumed_delegate → incorporate_answer.
    """
    text = str(answer or "").strip()
    if not delegate and not text:
        raise ValueError("Provide an answer (or delegate) to continue Clash Mode")
    return {
        "resumed_answer": "" if delegate else text,
        "resumed_delegate": bool(delegate),
    }


def build_clash_resume_command(
    *,
    answer: Optional[str],
    delegate: bool = False,
):
    """Resume a V2 interrupt pause on the same thread."""
    from langgraph.types import Command

    text = str(answer or "").strip()
    if not delegate and not text:
        raise ValueError("Provide an answer (or delegate) to continue Clash Mode")
    return Command(
        resume={
            "answer": "" if delegate else text,
            "delegate": bool(delegate),
        }
    )


def clash_resume_payload(
    *,
    answer: Optional[str],
    delegate: bool = False,
) -> Any:
    """Return Command(resume=...) when V2 is on, else legacy state delta."""
    if CLASH_EFFICIENCY_V2:
        return build_clash_resume_command(answer=answer, delegate=delegate)
    return build_clash_resume_inputs(answer=answer, delegate=delegate)


def clash_thread_config(
    thread_id: str,
    *,
    statics: Optional[dict[str, Any]] = None,
    case_title: Any = None,
    case_facts: Any = None,
    mock_case_id: Any = None,
    session_id: Any = None,
    mode: Any = None,
    user_role: Any = None,
    judge_parameters: Any = None,
) -> dict[str, dict[str, Any]]:
    """Build the checkpointer config shared by admin and user runners."""
    cfg: dict[str, Any] = {"thread_id": str(thread_id)}
    if statics:
        cfg.update(statics)
    elif case_title is not None or case_facts is not None:
        cfg.update(
            statics_for_config(
                case_title=str(case_title or "Matter"),
                case_facts=str(case_facts or ""),
                mock_case_id=mock_case_id,
                session_id=str(session_id or thread_id),
                mode=normalize_clash_mode(mode),
                user_role=normalize_user_role(user_role),
                judge_parameters=judge_parameters or JUDGE_PARAMETERS,
            )
        )
    return {"configurable": cfg}


def statics_from_start_inputs(inputs: dict[str, Any]) -> dict[str, Any]:
    return statics_for_config(
        case_title=inputs.get("case_title") or "Matter",
        case_facts=inputs.get("case_facts") or "",
        mock_case_id=inputs.get("mock_case_id"),
        session_id=str(inputs.get("session_id") or ""),
        mode=normalize_clash_mode(inputs.get("mode")),
        user_role=normalize_clash_role(inputs.get("user_role")),
        judge_parameters=inputs.get("judge_parameters") or JUDGE_PARAMETERS,
    )
