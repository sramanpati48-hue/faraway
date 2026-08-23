"""AI answers a cross-examination question for either side (with RAG).

Used by the legacy CLASH_EFFICIENCY_V2=0 path. V2 folds this into cross_exam_node.
"""
from langchain_core.messages import HumanMessage, SystemMessage

from backend.agents.clash.context import case_facts, case_title
from backend.agents.clash.llm import get_clash_llm
from backend.agents.clash.prompts import counsel_human_reminder, cross_answer_system_prompt
from backend.agents.clash.retrieval import (
    build_rag_query,
    citation_labels,
    format_rag_prompt_block,
    get_cached_or_retrieve,
    purge_pending_rag,
)
from backend.agents.clash.roles import opposing_side
from backend.agents.clash.utils import (
    asked_questions_delta,
    build_logic_entries,
    normalize_counsel_voice,
    parse_agent_response_with_repair,
)


def ai_cross_answer_node(state: dict) -> dict:
    """Answer pending_question on behalf of answering_side (or inferred target)."""
    question = state.get("pending_question") or ""
    phase = state.get("phase") or "opening"
    title = case_title(state)
    facts = case_facts(state)
    qid = state.get("pending_question_id") or ""
    asker = state.get("question_agent_side") or "prosecution"
    if asker not in ("prosecution", "defence"):
        asker = "prosecution"
    answering_side = state.get("answering_side") or opposing_side(asker)
    opposing_arg = (
        state.get("prosecution_output")
        if answering_side == "defence"
        else state.get("defence_output")
    ) or ""

    print(f"⚖️ AI cross-answer ({answering_side}) — phase={phase}")

    query = build_rag_query(
        case_facts=facts,
        phase=phase,
        side=answering_side,
        opposing_argument=opposing_arg,
        extra=f"Answering cross-examination: {question}",
    )
    context_text, citations, cache_update = get_cached_or_retrieve(
        state, side=f"{answering_side}_cross", phase=phase, query=query
    )
    rag_block = format_rag_prompt_block(context_text, side=answering_side)

    system = cross_answer_system_prompt(
        answering_side,
        phase,
        title,
        facts,
        question,
        opposing_arg,
        rag_block,
    )
    llm = get_clash_llm("ai_cross_answer")
    response = llm.invoke(
        [
            SystemMessage(content=system),
            HumanMessage(
                content=(
                    f"{counsel_human_reminder(answering_side, phase, cross=True)}\n"
                    "Answer the cross-examination question. JSON only; no new question. "
                    "Keep argument under 80 words so the JSON is complete."
                )
            ),
        ],
        max_tokens=2000,
        temperature=0.4,
    )
    raw = response.content if isinstance(response.content, str) else str(response.content)
    parsed, err = parse_agent_response_with_repair(
        raw, llm=llm, require_argument=True, max_tokens=2000
    )
    if err:
        return {
            "counsel_error": err,
            "next_step": "wait_user",
            **purge_pending_rag(),
        }

    answer_text = (parsed.get("argument") or "").strip()
    reasoning, answer_text = normalize_counsel_voice(
        answering_side,
        parsed.get("reasoning_steps") or [],
        answer_text,
    )
    if not answer_text and reasoning:
        last = reasoning[-1]
        answer_text = last.split(":", 1)[-1].strip() if ":" in last else last
    law_sections = parsed.get("law_sections") or citation_labels(citations)

    transcript = []
    if question and not any(
        isinstance(e, dict)
        and e.get("kind") == "question"
        and e.get("question_id") == qid
        for e in (state.get("transcript_entries") or [])
    ):
        transcript.append(
            {
                "side": asker,
                "phase": phase,
                "kind": "question",
                "content": question,
                "question_id": qid,
                "question_target": answering_side,
                "law_sections": state.get("pending_law_sections") or [],
            }
        )
    for step in reasoning:
        transcript.append(
            {
                "side": answering_side,
                "phase": phase,
                "kind": "reasoning",
                "content": step,
                "law_sections": law_sections,
            }
        )
    transcript.append(
        {
            "side": answering_side,
            "phase": phase,
            "kind": "cross_answer",
            "content": answer_text,
            "question_id": qid,
            "law_sections": law_sections,
        }
    )

    stage = state.get("cross_exam_stage") or "d_answer"
    if stage == "d_answer":
        next_stage = "d_ask"
    elif stage == "p_answer":
        next_stage = "done"
    else:
        next_stage = "done"

    return {
        "transcript_entries": transcript,
        "logic_log": build_logic_entries(
            side=answering_side,
            phase=phase,
            reasoning_steps=reasoning,
            law_sections=law_sections,
            argument=f"[Cross-exam reply] {answer_text}",
        ),
        "user_answers": [
            {
                "question_id": qid,
                "question": question,
                "answer": answer_text,
                "agent_side": asker,
                "phase": phase,
                "target": answering_side,
            }
        ],
        "asked_questions": asked_questions_delta(
            list(state.get("asked_questions") or []), question
        ),
        "pending_question": None,
        "pending_question_id": None,
        "question_agent_side": None,
        "question_target": None,
        "answering_side": None,
        "pending_law_sections": None,
        "pending_reasoning_steps": None,
        "cross_answer_text": answer_text,
        "cross_answer_id": qid,
        "cross_answer_side": answering_side,
        "awaiting_user_input": False,
        "user_action": None,
        "ai_assist_allowed": False,
        "force_ai": False,
        "cross_exam_stage": next_stage,
        "pending_rag_citations": citations,
        "next_step": "cross_exam",
        "counsel_error": None,
        **cache_update,
    }


def defence_cross_answer_node(state: dict) -> dict:
    return ai_cross_answer_node({**state, "answering_side": "defence"})
