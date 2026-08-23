"""Cross-examination: single node with internal stage machine (p_ask→d_answer→d_ask→p_answer→done)."""
from __future__ import annotations

from typing import Any, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from backend.agents.clash.context import CLASH_EFFICIENCY_V2, case_facts, case_title
from backend.agents.clash.llm import get_clash_llm
from backend.agents.clash.pause import clear_pause_flags, pause_or_interrupt
from backend.agents.clash.prompts import (
    counsel_human_reminder,
    cross_answer_system_prompt,
    cross_ask_system_prompt,
)
from backend.agents.clash.retrieval import (
    build_rag_query,
    citation_labels,
    format_rag_prompt_block,
    get_cached_or_retrieve,
    purge_pending_rag,
    shorten_law_label,
)
from backend.agents.clash.roles import (
    ai_assist_allowed,
    opposing_side,
    party_label,
    should_user_answer,
    should_user_ask,
)
from backend.agents.clash.utils import (
    asked_questions_delta,
    build_clash_conversation_context,
    build_logic_entries,
    extract_follow_up_question,
    format_asked_questions_block,
    new_question_id,
    normalize_counsel_voice,
    parse_agent_response_with_repair,
    tag_follow_up_for_side,
)

# Stages: p_ask -> d_answer -> d_ask -> p_answer -> done


def _fallback_cross_question(*, case_title: str, case_facts: str) -> str:
    topic = (case_title or "").strip()
    if not topic:
        snippet = " ".join((case_facts or "").split())
        if len(snippet) > 100:
            cut = snippet[:100].rsplit(" ", 1)[0]
            topic = f"{cut}…" if cut else f"{snippet[:100]}…"
        else:
            topic = snippet or "the facts on record"
    return f"Explain the factual basis for your position regarding {topic}."


def _looks_incomplete_question(question: str) -> bool:
    q = (question or "").strip()
    if not q:
        return True
    if q.endswith("?"):
        return False
    last_word = q.rstrip(".\"'").rsplit(" ", 1)[-1]
    if len(last_word) <= 2:
        return True
    if not q.endswith((".", '"', "'")):
        return True
    return False


def _normalize_law_sections(raw) -> list:
    labels = []
    for item in raw or []:
        label = shorten_law_label(str(item))
        if label and label not in labels:
            labels.append(label)
    return labels


def _merge(acc: dict, partial: dict) -> dict:
    for k, v in (partial or {}).items():
        if k in ("transcript_entries", "logic_log", "user_answers", "asked_questions", "messages"):
            existing = list(acc.get(k) or [])
            if isinstance(v, list):
                acc[k] = existing + v
            else:
                acc[k] = existing
        elif k == "rag_cache" and isinstance(v, dict):
            cache = dict(acc.get("rag_cache") or {})
            cache.update(v)
            acc[k] = cache
        else:
            acc[k] = v
    return acc


def _next_after_ask(asker: str) -> str:
    return "d_answer" if asker == "prosecution" else "p_answer"


def _next_after_answer(stage: str) -> str:
    if stage == "d_answer":
        return "d_ask"
    return "done"


def _ai_answer_inline(state: dict, answering_side: str) -> dict:
    """Fold former ai_cross_answer node into cross_exam."""
    question = state.get("pending_question") or ""
    phase = state.get("phase") or "opening"
    title = case_title(state)
    facts = case_facts(state)
    qid = state.get("pending_question_id") or ""
    asker = state.get("question_agent_side") or opposing_side(answering_side)
    if asker not in ("prosecution", "defence"):
        asker = opposing_side(answering_side)
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
        answering_side, phase, title, facts, question, opposing_arg, rag_block
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
        return {"counsel_error": err, "next_step": "wait_user", **purge_pending_rag()}

    answer_text = (parsed.get("argument") or "").strip()
    reasoning, answer_text = normalize_counsel_voice(
        answering_side, parsed.get("reasoning_steps") or [], answer_text
    )
    if not answer_text and reasoning:
        last = reasoning[-1]
        answer_text = last.split(":", 1)[-1].strip() if ":" in last else last
    law_sections = parsed.get("law_sections") or citation_labels(citations)

    transcript: list[dict] = []
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
        "cross_answer_text": answer_text,
        "cross_answer_id": qid,
        "cross_answer_side": answering_side,
        "awaiting_user_input": False,
        "user_action": None,
        "ai_assist_allowed": False,
        "force_ai": False,
        "pending_rag_citations": citations,
        "counsel_error": None,
        **cache_update,
        **{k: v for k, v in purge_pending_rag().items() if k != "pending_rag_citations"},
    }


def _ai_ask_only(state: dict, asker: str) -> dict:
    phase = state.get("phase") or "opening"
    title = case_title(state)
    facts = case_facts(state)
    target = opposing_side(asker)
    opposing_arg = (
        state.get("defence_output") if asker == "prosecution" else state.get("prosecution_output")
    ) or ""

    asked = list(state.get("asked_questions") or [])
    convo = build_clash_conversation_context(state)
    asked_block = format_asked_questions_block(asked)

    query = build_rag_query(
        case_facts=facts,
        phase=phase,
        side=asker,
        opposing_argument=opposing_arg,
        extra="Formulate one cross-examination question",
    )
    context_text, citations, cache_update = get_cached_or_retrieve(
        state, side=f"{asker}_ask", phase=phase, query=query
    )
    rag_block = format_rag_prompt_block(context_text, side=asker)

    system = cross_ask_system_prompt(
        asker, phase, title, facts, convo, asked_block, opposing_arg, rag_block
    )
    llm = get_clash_llm("cross_exam")
    response = llm.invoke(
        [
            SystemMessage(content=system),
            HumanMessage(
                content=(
                    f"{counsel_human_reminder(asker, phase)}\n"
                    f"Ask ONE new cross-examination question to the {target}. JSON only."
                )
            ),
        ],
        max_tokens=2000,
        temperature=0.45,
    )
    raw = response.content if isinstance(response.content, str) else str(response.content)
    parsed, err = parse_agent_response_with_repair(
        raw, llm=llm, require_argument=False, require_question=True, max_tokens=2000
    )
    # Soft-fail: fall back to template question rather than aborting the debate
    raw_q = None
    if not err:
        raw_q = parsed.get("follow_up_question") or parsed.get("question")
    question = str(raw_q).strip() if raw_q is not None else ""
    if question.lower() in ("null", "none", "n/a", ""):
        question = (
            extract_follow_up_question(
                parsed or {},
                side=asker,
                phase="rebuttal" if phase == "closing" else phase,
                argument=parsed.get("argument") or "" if parsed else "",
                case_facts=facts,
                opposition_arg=opposing_arg,
                asked_questions=asked,
            )
            or ""
        )
    if question and _looks_incomplete_question(question):
        question = ""
    if not question:
        question = _fallback_cross_question(case_title=title, case_facts=facts)
    question = tag_follow_up_for_side(asker, str(question))
    reasoning, _ = normalize_counsel_voice(
        asker, (parsed or {}).get("reasoning_steps") or [], ""
    )
    law_sections = _normalize_law_sections(
        (parsed or {}).get("law_sections") or citation_labels(citations)
    )
    qid = new_question_id()

    transcript: list[dict] = []
    for step in reasoning:
        transcript.append(
            {
                "side": asker,
                "phase": phase,
                "kind": "reasoning",
                "content": step,
                "law_sections": law_sections,
            }
        )
    transcript.append(
        {
            "side": asker,
            "phase": phase,
            "kind": "question",
            "content": question,
            "question_id": qid,
            "question_target": target,
            "law_sections": law_sections,
        }
    )

    return {
        "transcript_entries": transcript,
        "asked_questions": asked_questions_delta(asked, question),
        "pending_question": question,
        "pending_question_id": qid,
        "question_agent_side": asker,
        "question_target": target,
        "answering_side": target,
        "pending_law_sections": law_sections,
        "pending_reasoning_steps": reasoning,
        "pending_rag_citations": citations,
        "force_ai": False,
        "counsel_error": None,
        **cache_update,
    }


def _ai_ask_and_answer(state: dict, asker: str) -> dict:
    """One structured LLM call for {question, answer} when both sides of the half are AI."""
    phase = state.get("phase") or "opening"
    title = case_title(state)
    facts = case_facts(state)
    target = opposing_side(asker)
    opposing_arg = (
        state.get("defence_output") if asker == "prosecution" else state.get("prosecution_output")
    ) or ""
    asked = list(state.get("asked_questions") or [])
    convo = build_clash_conversation_context(state)
    asked_block = format_asked_questions_block(asked)

    query = build_rag_query(
        case_facts=facts,
        phase=phase,
        side=asker,
        opposing_argument=opposing_arg,
        extra="Cross-examination question and answer pair",
    )
    context_text, citations, cache_update = get_cached_or_retrieve(
        state, side=f"{asker}_qa", phase=phase, query=query
    )
    rag_block = format_rag_prompt_block(context_text, side=asker)

    system = (
        f"{cross_ask_system_prompt(asker, phase, title, facts, convo, asked_block, opposing_arg, rag_block)}\n\n"
        f"ALSO produce the {target}'s answer in the same JSON as "
        f'"answer" (string) and "answer_reasoning_steps" (string array). '
        f"The answerer is {target} counsel — stay in that voice."
    )
    llm = get_clash_llm("cross_exam")
    response = llm.invoke(
        [
            SystemMessage(content=system),
            HumanMessage(
                content=(
                    f"{counsel_human_reminder(asker, phase)}\n"
                    f"Return JSON with follow_up_question (to {target}) AND answer "
                    f"(from {target}). Keep each under 60 words."
                )
            ),
        ],
        max_tokens=2000,
        temperature=0.4,
    )
    raw = response.content if isinstance(response.content, str) else str(response.content)
    parsed, _err = parse_agent_response_with_repair(
        raw, llm=llm, require_argument=False, require_question=True, max_tokens=2000
    )
    # If combined parse fails question requirement, fall back to ask-only + answer-only
    raw_q = (parsed or {}).get("follow_up_question") or (parsed or {}).get("question")
    question = str(raw_q).strip() if raw_q else ""
    if not question or _looks_incomplete_question(question):
        ask_part = _ai_ask_only(state, asker)
        mid = {**state, **ask_part, "rag_cache": {**(state.get("rag_cache") or {}), **(ask_part.get("rag_cache") or {})}}
        ans_part = _ai_answer_inline(mid, target)
        return _merge(dict(ask_part), ans_part)

    question = tag_follow_up_for_side(asker, question)
    answer_text = str(
        (parsed or {}).get("answer") or (parsed or {}).get("argument") or ""
    ).strip()
    ask_reasoning, _ = normalize_counsel_voice(
        asker, (parsed or {}).get("reasoning_steps") or [], ""
    )
    ans_steps = (parsed or {}).get("answer_reasoning_steps") or []
    if not isinstance(ans_steps, list):
        ans_steps = []
    ans_reasoning, answer_text = normalize_counsel_voice(target, ans_steps, answer_text)
    if not answer_text:
        # Fall back to separate answer call
        ask_part = _ai_ask_only(state, asker)
        mid = {**state, **ask_part}
        return _merge(dict(ask_part), _ai_answer_inline(mid, target))

    law_sections = _normalize_law_sections(
        (parsed or {}).get("law_sections") or citation_labels(citations)
    )
    qid = new_question_id()
    transcript: list[dict] = []
    for step in ask_reasoning:
        transcript.append(
            {
                "side": asker,
                "phase": phase,
                "kind": "reasoning",
                "content": step,
                "law_sections": law_sections,
            }
        )
    transcript.append(
        {
            "side": asker,
            "phase": phase,
            "kind": "question",
            "content": question,
            "question_id": qid,
            "question_target": target,
            "law_sections": law_sections,
        }
    )
    for step in ans_reasoning:
        transcript.append(
            {
                "side": target,
                "phase": phase,
                "kind": "reasoning",
                "content": step,
                "law_sections": law_sections,
            }
        )
    transcript.append(
        {
            "side": target,
            "phase": phase,
            "kind": "cross_answer",
            "content": answer_text,
            "question_id": qid,
            "law_sections": law_sections,
        }
    )

    return {
        "transcript_entries": transcript,
        "logic_log": build_logic_entries(
            side=target,
            phase=phase,
            reasoning_steps=ans_reasoning,
            law_sections=law_sections,
            argument=f"[Cross-exam reply] {answer_text}",
        )
        + build_logic_entries(
            side=asker,
            phase=phase,
            reasoning_steps=ask_reasoning,
            law_sections=law_sections,
            argument="",
        ),
        "asked_questions": asked_questions_delta(asked, question),
        "user_answers": [
            {
                "question_id": qid,
                "question": question,
                "answer": answer_text,
                "agent_side": asker,
                "phase": phase,
                "target": target,
            }
        ],
        "pending_question": None,
        "pending_question_id": None,
        "question_agent_side": None,
        "question_target": None,
        "answering_side": None,
        "cross_answer_text": answer_text,
        "cross_answer_id": qid,
        "cross_answer_side": target,
        "awaiting_user_input": False,
        "force_ai": False,
        "pending_rag_citations": citations,
        "counsel_error": None,
        **cache_update,
        **{k: v for k, v in purge_pending_rag().items() if k != "pending_rag_citations"},
    }


def _record_user_question(state: dict, asker: str, question: str) -> dict:
    phase = state.get("phase") or "opening"
    target = opposing_side(asker)
    qid = state.get("pending_question_id") or new_question_id()
    question = tag_follow_up_for_side(asker, question)
    return {
        "transcript_entries": [
            {
                "side": asker,
                "phase": phase,
                "kind": "question",
                "content": question,
                "question_id": qid,
                "question_target": target,
                "law_sections": [],
            }
        ],
        "asked_questions": asked_questions_delta(
            list(state.get("asked_questions") or []), question
        ),
        "pending_question": question,
        "pending_question_id": qid,
        "question_agent_side": asker,
        "question_target": target,
        "answering_side": target,
        "user_provided_question": None,
        "force_ai": False,
    }


def _record_user_answer(state: dict, answer: str) -> dict:
    question = state.get("pending_question") or ""
    qid = state.get("pending_question_id") or ""
    phase = state.get("phase") or "opening"
    asker = state.get("question_agent_side") or "prosecution"
    target = state.get("answering_side") or state.get("question_target") or opposing_side(asker)
    if target not in ("prosecution", "defence"):
        target = opposing_side(asker if asker in ("prosecution", "defence") else "prosecution")

    return {
        "transcript_entries": [
            {
                "side": "user",
                "phase": phase,
                "kind": "user_answer",
                "content": answer,
                "question_id": qid,
                "asked_by": asker,
                "answering_side": target,
            }
        ],
        "user_answers": [
            {
                "question_id": qid,
                "question": question,
                "answer": answer,
                "agent_side": asker,
                "phase": phase,
                "target": target,
            }
        ],
        "asked_questions": asked_questions_delta(
            list(state.get("asked_questions") or []), question
        ),
        "cross_answer_text": answer,
        "cross_answer_id": qid,
        "cross_answer_side": target,
        "pending_question": None,
        "pending_question_id": None,
        "question_agent_side": None,
        "question_target": None,
        "answering_side": None,
        "user_provided_answer": None,
        **clear_pause_flags(),
        **purge_pending_rag(),
    }


def _both_ai_for_half(state: dict, asker: str) -> bool:
    target = opposing_side(asker)
    return (not should_user_ask(state, asker)) and (not should_user_answer(state, target))


def cross_exam_node(state: dict) -> dict:
    """Drive p_ask → d_answer → d_ask → p_answer → done in one node when possible."""
    stage = state.get("cross_exam_stage") or "p_ask"
    print(f"⚖️ Cross-exam stage={stage} phase={state.get('phase')} v2={CLASH_EFFICIENCY_V2}")

    # Legacy incorporate resume hooks
    if state.get("user_provided_answer"):
        partial = _record_user_answer(state, state.get("user_provided_answer") or "")
        stage = _next_after_answer(stage if stage in ("d_answer", "p_answer") else "d_answer")
        state = {**state, **partial, "cross_exam_stage": stage}
        if not CLASH_EFFICIENCY_V2:
            return {**partial, "cross_exam_stage": stage, "next_step": "cross_exam"}

    if state.get("user_provided_question"):
        asker = "prosecution" if stage in ("p_ask", "d_answer") else "defence"
        if stage == "p_ask":
            asker = "prosecution"
        elif stage == "d_ask":
            asker = "defence"
        partial = _record_user_question(state, asker, state.get("user_provided_question") or "")
        stage = _next_after_ask(asker)
        state = {**state, **partial, "cross_exam_stage": stage}
        if not CLASH_EFFICIENCY_V2:
            if should_user_answer(state, opposing_side(asker)):
                return {
                    **partial,
                    "cross_exam_stage": stage,
                    "awaiting_user_input": True,
                    "user_action": "answer",
                    "ai_assist_allowed": ai_assist_allowed(state),
                    "resume_node": "cross_exam",
                    "next_step": "wait_user",
                }
            return {**partial, "cross_exam_stage": stage, "next_step": "ai_cross_answer"}

    acc: dict[str, Any] = {
        "rag_cache": dict(state.get("rag_cache") or {}),
    }
    working = dict(state)

    while stage != "done":
        if stage == "p_ask":
            asker = "prosecution"
            if should_user_ask(working, asker):
                legacy, resume = pause_or_interrupt(
                    working,
                    prompt=(
                        f"As Prosecution, ask ONE cross-examination question to the "
                        f"{party_label('defence')}."
                    ),
                    question_agent_side="prosecution",
                    question_target="defence",
                    user_action="ask",
                    resume_node="cross_exam",
                    extra={"cross_exam_stage": "p_ask"},
                )
                if legacy is not None:
                    return {**legacy, "cross_exam_stage": "p_ask"}
                assert resume is not None
                answer, delegate = resume
                if delegate:
                    if _both_ai_for_half({**working, "force_ai": True}, asker):
                        partial = _ai_ask_and_answer({**working, "force_ai": True}, asker)
                        _merge(acc, partial)
                        working = {**working, **partial}
                        stage = "d_ask"
                        continue
                    partial = _ai_ask_only({**working, "force_ai": True}, asker)
                    _merge(acc, partial)
                    working = {**working, **partial}
                    stage = "d_answer"
                    continue
                partial = _record_user_question(working, asker, answer)
                _merge(acc, partial)
                working = {**working, **partial}
                stage = "d_answer"
                continue

            if CLASH_EFFICIENCY_V2 and _both_ai_for_half(working, asker):
                partial = _ai_ask_and_answer(working, asker)
                _merge(acc, partial)
                working = {**working, **partial}
                stage = "d_ask"
                continue

            partial = _ai_ask_only(working, asker)
            _merge(acc, partial)
            working = {**working, **partial}
            stage = "d_answer"
            # Checkpoint before user-answer interrupt (AI work must not re-run)
            if should_user_answer(working, "defence"):
                return {
                    **acc,
                    "cross_exam_stage": "d_answer",
                    "next_step": "cross_exam",
                }
            continue

        if stage == "d_answer":
            target = "defence"
            if should_user_answer(working, target) and working.get("pending_question"):
                legacy, resume = pause_or_interrupt(
                    working,
                    prompt=working.get("pending_question") or "Answer the cross-examination question.",
                    question_agent_side=working.get("question_agent_side") or "prosecution",
                    question_target=target,
                    user_action="answer",
                    resume_node="cross_exam",
                    answering_side=target,
                    pending_law_sections=working.get("pending_law_sections"),
                    pending_reasoning_steps=working.get("pending_reasoning_steps"),
                    question_id=working.get("pending_question_id"),
                    extra={"cross_exam_stage": "d_answer"},
                )
                if legacy is not None:
                    return {**legacy, "cross_exam_stage": "d_answer"}
                assert resume is not None
                answer, delegate = resume
                if delegate:
                    partial = _ai_answer_inline({**working, "force_ai": True}, target)
                else:
                    partial = _record_user_answer(working, answer)
                _merge(acc, partial)
                working = {**working, **partial}
                stage = "d_ask"
                continue

            if working.get("pending_question"):
                if not CLASH_EFFICIENCY_V2:
                    return {
                        **acc,
                        "answering_side": target,
                        "cross_exam_stage": "d_answer",
                        "next_step": "ai_cross_answer",
                    }
                partial = _ai_answer_inline(working, target)
                _merge(acc, partial)
                working = {**working, **partial}
                stage = "d_ask"
                continue
            stage = "d_ask"
            continue

        if stage == "d_ask":
            asker = "defence"
            if should_user_ask(working, asker):
                legacy, resume = pause_or_interrupt(
                    working,
                    prompt=(
                        f"As Defence, ask ONE cross-examination question to the "
                        f"{party_label('prosecution')}."
                    ),
                    question_agent_side="defence",
                    question_target="prosecution",
                    user_action="ask",
                    resume_node="cross_exam",
                    extra={"cross_exam_stage": "d_ask"},
                )
                if legacy is not None:
                    return {**legacy, "cross_exam_stage": "d_ask"}
                assert resume is not None
                answer, delegate = resume
                if delegate:
                    if _both_ai_for_half({**working, "force_ai": True}, asker):
                        partial = _ai_ask_and_answer({**working, "force_ai": True}, asker)
                        _merge(acc, partial)
                        working = {**working, **partial}
                        stage = "done"
                        continue
                    partial = _ai_ask_only({**working, "force_ai": True}, asker)
                    _merge(acc, partial)
                    working = {**working, **partial}
                    stage = "p_answer"
                    continue
                partial = _record_user_question(working, asker, answer)
                _merge(acc, partial)
                working = {**working, **partial}
                stage = "p_answer"
                continue

            if CLASH_EFFICIENCY_V2 and _both_ai_for_half(working, asker):
                partial = _ai_ask_and_answer(working, asker)
                _merge(acc, partial)
                working = {**working, **partial}
                stage = "done"
                continue

            partial = _ai_ask_only(working, asker)
            _merge(acc, partial)
            working = {**working, **partial}
            stage = "p_answer"
            if should_user_answer(working, "prosecution"):
                return {
                    **acc,
                    "cross_exam_stage": "p_answer",
                    "next_step": "cross_exam",
                }
            continue

        if stage == "p_answer":
            target = "prosecution"
            if should_user_answer(working, target) and working.get("pending_question"):
                legacy, resume = pause_or_interrupt(
                    working,
                    prompt=working.get("pending_question") or "Answer the cross-examination question.",
                    question_agent_side=working.get("question_agent_side") or "defence",
                    question_target=target,
                    user_action="answer",
                    resume_node="cross_exam",
                    answering_side=target,
                    pending_law_sections=working.get("pending_law_sections"),
                    pending_reasoning_steps=working.get("pending_reasoning_steps"),
                    question_id=working.get("pending_question_id"),
                    extra={"cross_exam_stage": "p_answer"},
                )
                if legacy is not None:
                    return {**legacy, "cross_exam_stage": "p_answer"}
                assert resume is not None
                answer, delegate = resume
                if delegate:
                    partial = _ai_answer_inline({**working, "force_ai": True}, target)
                else:
                    partial = _record_user_answer(working, answer)
                _merge(acc, partial)
                working = {**working, **partial}
                stage = "done"
                continue

            if working.get("pending_question"):
                if not CLASH_EFFICIENCY_V2:
                    return {
                        **acc,
                        "answering_side": target,
                        "cross_exam_stage": "p_answer",
                        "next_step": "ai_cross_answer",
                    }
                partial = _ai_answer_inline(working, target)
                _merge(acc, partial)
                working = {**working, **partial}
            stage = "done"
            continue

        stage = "done"

    return {
        **acc,
        **clear_pause_flags(),
        "cross_exam_stage": None,
        "next_step": "judge_round",
        "counsel_error": acc.get("counsel_error"),
    }
