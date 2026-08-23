"""Prosecution / complainant agent turn — role-aware with RAG grounding."""
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from backend.agents.clash.context import case_facts, case_title, has_phase_argument
from backend.agents.clash.llm import get_clash_llm
from backend.agents.clash.pause import clear_pause_flags, pause_or_interrupt
from backend.agents.clash.prompts import counsel_human_reminder, prosecution_system_prompt
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
    phase_digest,
)


def _store_user_argument(state: dict, answer: str, phase: str) -> dict:
    reasoning = ["Prosecution: (user submission)"]
    return {
        **clear_pause_flags(),
        "messages": [AIMessage(content=answer)],
        "prosecution_output": answer,
        "prosecution_reasoning": reasoning,
        "prosecution_law_sections": [],
        "transcript_entries": [
            {
                "side": "prosecution",
                "phase": phase,
                "kind": "argument",
                "content": answer,
                "law_sections": [],
                "from_user": True,
            }
        ],
        "logic_log": build_logic_entries(
            side="prosecution",
            phase=phase,
            reasoning_steps=reasoning,
            law_sections=[],
            argument=answer,
        ),
        "user_provided_argument_side": None,
        "counsel_error": None,
        "next_step": "defence",
        **purge_pending_rag(),
    }


def _generate_prosecution_argument(state: dict) -> dict:
    phase = state.get("phase") or "opening"
    print(f"⚖️ Clash prosecution turn (AI) — phase={phase}")
    llm = get_clash_llm("prosecution")
    title = case_title(state)
    facts = case_facts(state)

    asked = list(state.get("asked_questions") or [])
    convo = build_clash_conversation_context(state)
    asked_block = format_asked_questions_block(asked)
    prior = phase_digest(state)

    query = build_rag_query(
        case_facts=facts,
        phase=phase,
        side="prosecution",
        opposing_argument=state.get("defence_output") or "",
    )
    context_text, citations, cache_update = get_cached_or_retrieve(
        state, side="prosecution", phase=phase, query=query
    )
    rag_block = format_rag_prompt_block(context_text, side="prosecution")

    system = prosecution_system_prompt(
        phase,
        title,
        facts,
        prior,
        convo,
        asked_block,
        rag_block,
        argument_only=True,
    )
    messages = [SystemMessage(content=system)]
    for m in state.get("messages") or []:
        messages.append(m)
    if not any(isinstance(m, HumanMessage) for m in messages[1:]):
        messages.append(
            HumanMessage(
                content=(
                    f"{counsel_human_reminder('prosecution', phase)}\n"
                    "Present your submission as JSON. reasoning_steps = Prosecution only; "
                    "follow_up_question must be null. Cite retrieved Indian law only."
                )
            )
        )

    response = llm.invoke(messages, max_tokens=2000, temperature=0.45)
    raw = response.content if isinstance(response.content, str) else str(response.content)
    parsed, err = parse_agent_response_with_repair(
        raw, llm=llm, require_argument=True, max_tokens=2000
    )
    if err:
        print(f"❌ Prosecution counsel JSON error: {err}")
        return {
            **clear_pause_flags(),
            "counsel_error": err,
            "next_step": "wait_user",
            **purge_pending_rag(),
        }

    argument = parsed.get("argument") or ""
    reasoning, argument = normalize_counsel_voice(
        "prosecution",
        parsed.get("reasoning_steps") or [],
        argument,
    )
    law_sections = parsed.get("law_sections") or citation_labels(citations)

    return {
        **clear_pause_flags(),
        "messages": [AIMessage(content=argument)],
        "prosecution_output": argument,
        "prosecution_reasoning": reasoning,
        "prosecution_law_sections": law_sections,
        "transcript_entries": build_transcript_entries(
            side="prosecution",
            phase=phase,
            reasoning_steps=reasoning,
            argument=argument,
            law_sections=law_sections,
        ),
        "logic_log": build_logic_entries(
            side="prosecution",
            phase=phase,
            reasoning_steps=reasoning,
            law_sections=law_sections,
            argument=argument,
        ),
        "pending_rag_citations": citations,
        "counsel_error": None,
        "next_step": "defence",
        **cache_update,
    }


def prosecution_turn_node(state: dict) -> dict:
    phase = state.get("phase") or "opening"

    # Task 3: skip if this phase already has a prosecution argument
    if has_phase_argument(state, "prosecution", phase):
        print(f"⚖️ Clash prosecution — skip (argument already on record for {phase})")
        return {
            **clear_pause_flags(),
            "user_provided_argument_side": None,
            "next_step": "defence",
        }

    if state.get("user_provided_argument_side") == "prosecution":
        if state.get("prosecution_output"):
            return {
                "user_provided_argument_side": None,
                "force_ai": False,
                "awaiting_user_input": False,
                "user_action": None,
                "next_step": "defence",
            }

    if should_user_argue(state, "prosecution"):
        print(f"⚖️ Clash prosecution — pausing for user argue (phase={phase})")
        prompt = (
            f"Present your opening submission as Prosecution counsel "
            f"({party_label('prosecution')}) for the {phase.replace('_', ' ')} phase. "
            "State your legal argument for the complainant."
        )
        legacy, resume = pause_or_interrupt(
            state,
            prompt=prompt,
            question_agent_side="system",
            question_target="prosecution",
            user_action="argue",
            resume_node="prosecution",
        )
        if legacy is not None:
            return legacy
        assert resume is not None
        answer, delegate = resume
        if delegate:
            return _generate_prosecution_argument({**state, "force_ai": True})
        return _store_user_argument(state, answer, phase)

    return _generate_prosecution_argument(state)
