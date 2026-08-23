"""LangGraph workflow for Clash Mode courtroom debate."""
from __future__ import annotations

import operator
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from backend.database.graph_checkpointer import build_checkpointer
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages

from backend.agents.clash import (
    ai_cross_answer_node,
    cross_exam_node,
    defence_turn_node,
    final_judge_node,
    incorporate_user_answer_node,
    judge_round_node,
    preprocess_case_node,
    prosecution_turn_node,
)
from backend.agents.clash.context import CLASH_EFFICIENCY_V2

CLASH_STREAM_NODES = {"prosecution", "defence"}


class ClashState(TypedDict, total=False):
    # mode / user_role stay mutable in state (role routing); static case fields live in config
    mode: str
    user_role: str
    # Legacy fields kept for CLASH_EFFICIENCY_V2=0 / old checkpoints
    case_title: str
    case_facts: str
    mock_case_id: Optional[str]
    session_id: str
    user_id: Optional[str]
    phase: str
    phase_index: int
    round_number: int
    messages: Annotated[List[Any], add_messages]
    prosecution_output: str
    defence_output: str
    judge_notes: str
    round_scores: Annotated[List[Dict[str, Any]], operator.add]
    final_result: Dict[str, Any]
    final_score: float
    verdict: str
    transcript_entries: Annotated[List[Dict[str, Any]], operator.add]
    logic_log: Annotated[List[Dict[str, Any]], operator.add]
    pending_question: Optional[str]
    pending_question_id: Optional[str]
    question_agent_side: Optional[str]
    question_target: Optional[str]
    answering_side: Optional[str]
    awaiting_user_input: bool
    resumed_answer: Optional[str]
    resumed_delegate: bool
    resume_node: Optional[str]
    user_answers: Annotated[List[Dict[str, Any]], operator.add]
    asked_questions: Annotated[List[str], operator.add]
    next_step: str
    user_action: Optional[str]
    ai_assist_allowed: bool
    force_ai: bool
    cross_exam_stage: Optional[str]
    rag_cache: Dict[str, Any]
    pending_rag_citations: Optional[List[Dict[str, Any]]]
    pending_law_sections: Optional[List[str]]
    pending_reasoning_steps: Optional[List[str]]
    user_provided_argument_side: Optional[str]
    user_provided_question: Optional[str]
    user_provided_answer: Optional[str]
    judge_parameters: List[Dict[str, Any]]
    cross_answer_text: Optional[str]
    cross_answer_id: Optional[str]
    cross_answer_side: Optional[str]
    # Derived for stream adapters (Task 9) — not canonical storage
    prosecution_reasoning: List[str]
    defence_reasoning: List[str]
    prosecution_law_sections: List[str]
    defence_law_sections: List[str]
    counsel_error: Optional[str]


def _route_after_prosecution(state: ClashState) -> str:
    if state.get("counsel_error"):
        return END
    if not CLASH_EFFICIENCY_V2 and state.get("awaiting_user_input"):
        return END
    return "defence"


def _route_after_defence(state: ClashState) -> str:
    if state.get("counsel_error"):
        return END
    if not CLASH_EFFICIENCY_V2 and state.get("awaiting_user_input"):
        return END
    return "cross_exam"


def _route_after_cross_exam(state: ClashState) -> str:
    if state.get("counsel_error"):
        return END
    if not CLASH_EFFICIENCY_V2 and state.get("awaiting_user_input"):
        return END
    nxt = state.get("next_step")
    if nxt == "ai_cross_answer" and not CLASH_EFFICIENCY_V2:
        return "ai_cross_answer"
    if nxt == "judge_round":
        return "judge_round"
    if nxt == "cross_exam":
        return "cross_exam"
    return "judge_round"


def _route_after_judge(state: ClashState) -> str:
    nxt = state.get("next_step", "end")
    if nxt == "prosecution":
        return "prosecution"
    if nxt == "final_judge":
        return "final_judge"
    return END


def _route_entry(state: ClashState) -> str:
    if not CLASH_EFFICIENCY_V2 and (
        state.get("resumed_answer") is not None or state.get("resumed_delegate")
    ):
        return "incorporate_answer"
    nxt = state.get("next_step")
    if nxt == "prosecution":
        return "prosecution"
    if nxt == "defence":
        return "defence"
    if nxt == "cross_exam":
        return "cross_exam"
    if nxt == "ai_cross_answer":
        return "ai_cross_answer"
    if nxt == "judge_round":
        return "judge_round"
    if nxt == "final_judge":
        return "final_judge"
    if nxt == "wait_user":
        return END
    return "preprocess"


def _route_after_incorporate(state: ClashState) -> str:
    nxt = state.get("next_step", "prosecution")
    if nxt == "defence":
        return "defence"
    if nxt == "cross_exam":
        return "cross_exam"
    if nxt == "ai_cross_answer":
        return "ai_cross_answer"
    if nxt == "judge_round":
        return "judge_round"
    if nxt == "prosecution":
        return "prosecution"
    if nxt == "wait_user":
        return END
    return "prosecution"


workflow = StateGraph(ClashState)

workflow.add_node("preprocess", preprocess_case_node)
workflow.add_node("prosecution", prosecution_turn_node)
workflow.add_node("defence", defence_turn_node)
workflow.add_node("cross_exam", cross_exam_node)
workflow.add_node("ai_cross_answer", ai_cross_answer_node)
workflow.add_node("judge_round", judge_round_node)
workflow.add_node("final_judge", final_judge_node)
workflow.add_node("incorporate_answer", incorporate_user_answer_node)

_entry_map = {
    "preprocess": "preprocess",
    "prosecution": "prosecution",
    "defence": "defence",
    "cross_exam": "cross_exam",
    "ai_cross_answer": "ai_cross_answer",
    "judge_round": "judge_round",
    "final_judge": "final_judge",
    END: END,
}
if not CLASH_EFFICIENCY_V2:
    _entry_map["incorporate_answer"] = "incorporate_answer"

workflow.set_conditional_entry_point(_route_entry, _entry_map)

workflow.add_edge("preprocess", "prosecution")
workflow.add_conditional_edges(
    "prosecution",
    _route_after_prosecution,
    {"defence": "defence", END: END},
)
workflow.add_conditional_edges(
    "defence",
    _route_after_defence,
    {"cross_exam": "cross_exam", END: END},
)
_cross_map = {
    "judge_round": "judge_round",
    "cross_exam": "cross_exam",
    END: END,
}
if not CLASH_EFFICIENCY_V2:
    _cross_map["ai_cross_answer"] = "ai_cross_answer"
workflow.add_conditional_edges("cross_exam", _route_after_cross_exam, _cross_map)
if not CLASH_EFFICIENCY_V2:
    workflow.add_edge("ai_cross_answer", "cross_exam")
else:
    # Keep node registered for old checkpoints / admin path labels; unused in V2 routing
    workflow.add_edge("ai_cross_answer", "cross_exam")
workflow.add_conditional_edges(
    "judge_round",
    _route_after_judge,
    {"prosecution": "prosecution", "final_judge": "final_judge", END: END},
)
if not CLASH_EFFICIENCY_V2:
    workflow.add_conditional_edges(
        "incorporate_answer",
        _route_after_incorporate,
        {
            "prosecution": "prosecution",
            "defence": "defence",
            "cross_exam": "cross_exam",
            "ai_cross_answer": "ai_cross_answer",
            "judge_round": "judge_round",
            END: END,
        },
    )
workflow.add_edge("final_judge", END)

checkpointer = build_checkpointer()
clash_graph = workflow.compile(checkpointer=checkpointer)
