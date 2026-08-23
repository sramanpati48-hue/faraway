"""Defence agent turn — role-aware with RAG grounding."""
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from backend.agents.clash.context import case_facts, case_title, has_phase_argument
from backend.agents.clash.llm import get_clash_llm
from backend.agents.clash.pause import clear_pause_flags, pause_or_interrupt
from backend.agents.clash.prompts import counsel_human_reminder, defence_system_prompt
from backend.agents.clash.retrieval import (
    build_rag_query,
    citation_labels,
    format_rag_prompt_block,
    get_cached_or_retrieve,
    purge_pending_rag,
)
from backend.agents.clash.roles import party_label, should_user_argue
from backend.agents.clash.utils import (
    build_clash_conversation_context,
    build_logic_entries,
    build_transcript_entries,
    format_asked_questions_block,
    normalize_counsel_voice,
    parse_agent_response_with_repair,
)


def _store_user_argument(state: dict, answer: str, phase: str) -> dict:
    reasoning = ["Defence: (user submission)"]
    return {
        **clear_pause_flags(),
        "messages": [AIMessage(content=answer)],
        "defence_output": answer,
        "defence_reasoning": reasoning,
        "defence_law_sections": [],
        "transcript_entries": [
            {
                "side": "defence",
                "phase": phase,
                "kind": "argument",
                "content": answer,
                "law_sections": [],
                "from_user": True,
            }
        ],
        "logic_log": build_logic_entries(
            side="defence",
            phase=phase,
            reasoning_steps=reasoning,
            law_sections=[],
            argument=answer,
        ),
        "user_provided_argument_side": None,
        "counsel_error": None,
        "next_step": "cross_exam",
        **purge_pending_rag(),
    }


def _generate_defence_argument(state: dict) -> dict:
    phase = state.get("phase") or "opening"
    print(f"⚖️ Clash defence turn (AI) — phase={phase}")
    llm = get_clash_llm("defence")
    title = case_title(state)
    facts = case_facts(state)
    prosecution_arg = state.get("prosecution_output") or ""

    asked = list(state.get("asked_questions") or [])
    convo = build_clash_conversation_context(state)
    asked_block = format_asked_questions_block(asked)

    query = build_rag_query(
        case_facts=facts,
        phase=phase,
        side="defence",
        opposing_argument=prosecution_arg,
    )
    context_text, citations, cache_update = get_cached_or_retrieve(
        state, side="defence", phase=phase, query=query
    )
    rag_block = format_rag_prompt_block(context_text, side="defence")

    system = defence_system_prompt(
        phase,
        title,
        facts,
        build_clash_conversation_context(state, transcript_window=8),
        prosecution_arg,
        convo,
        asked_block,
        rag_block,
        argument_only=True,
    )
    messages = [
        SystemMessage(content=system),
        HumanMessage(
            content=(
                f"{counsel_human_reminder('defence', phase)}\n"
                "Present your submission as JSON. reasoning_steps = Defence only; "
                "follow_up_question must be null. Cite retrieved Indian law only."
            )
        ),
    ]

    response = llm.invoke(messages, max_tokens=2000, temperature=0.45)
    raw = response.content if isinstance(response.content, str) else str(response.content)
    parsed, err = parse_agent_response_with_repair(
        raw, llm=llm, require_argument=True, max_tokens=2000
    )
    if err:
        print(f"❌ Defence counsel JSON error: {err}")
        return {
            **clear_pause_flags(),
            "counsel_error": err,
            "next_step": "wait_user",
            **purge_pending_rag(),
        }

    argument = parsed.get("argument") or ""
    reasoning, argument = normalize_counsel_voice(
        "defence",
        parsed.get("reasoning_steps") or [],
        argument,
    )
    law_sections = parsed.get("law_sections") or citation_labels(citations)

    return {
        **clear_pause_flags(),
        "messages": [AIMessage(content=argument)],
        "defence_output": argument,
        "defence_reasoning": reasoning,
        "defence_law_sections": law_sections,
        "transcript_entries": build_transcript_entries(
            side="defence",
            phase=phase,
            reasoning_steps=reasoning,
            argument=argument,
            law_sections=law_sections,
        ),
        "logic_log": build_logic_entries(
            side="defence",
            phase=phase,
            reasoning_steps=reasoning,
            law_sections=law_sections,
            argument=argument,
        ),
        "pending_rag_citations": citations,
        "counsel_error": None,
        "next_step": "cross_exam",
        **cache_update,
    }


def defence_turn_node(state: dict) -> dict:
    phase = state.get("phase") or "opening"

    if has_phase_argument(state, "defence", phase):
        print(f"⚖️ Clash defence — skip (argument already on record for {phase})")
        return {
            **clear_pause_flags(),
            "user_provided_argument_side": None,
            "next_step": "cross_exam",
        }

    if state.get("user_provided_argument_side") == "defence":
        if state.get("defence_output"):
            return {
                "user_provided_argument_side": None,
                "force_ai": False,
                "awaiting_user_input": False,
                "user_action": None,
                "next_step": "cross_exam",
            }

    if should_user_argue(state, "defence"):
        print(f"⚖️ Clash defence — pausing for user argue (phase={phase})")
        prompt = (
            f"Present your submission as Defence counsel "
            f"({party_label('defence')}) for the {phase.replace('_', ' ')} phase. "
            "Rebut the Prosecution and argue for the accused."
        )
        legacy, resume = pause_or_interrupt(
            state,
            prompt=prompt,
            question_agent_side="system",
            question_target="defence",
            user_action="argue",
            resume_node="defence",
        )
        if legacy is not None:
            return legacy
        assert resume is not None
        answer, delegate = resume
        if delegate:
            return _generate_defence_argument({**state, "force_ai": True})
        return _store_user_argument(state, answer, phase)

    return _generate_defence_argument(state)
