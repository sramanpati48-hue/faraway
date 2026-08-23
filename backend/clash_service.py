"""Clash Mode session management and NDJSON streaming."""
import json
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from backend.clash_graph import CLASH_STREAM_NODES
from backend.agents.clash.utils import normalize_counsel_voice, parse_agent_response
from backend.clash_schemas import (
    ClashAnswerRequest,
    ClashCaseInput,
    ClashMockCase,
    ClashMode,
    ClashPhase,
    ClashSession,
    ClashSessionCreate,
    FinalClashResult,
    JudgeScore,
    ParameterScore,
)

from backend.paths import REPO_ROOT
from backend.agents.clash.context import CLASH_EFFICIENCY_V2
from backend.agents.clash.pause import interrupt_payload_from_graph_state
from backend.agents.clash.utils import latest_side_fields_from_transcript
from backend.services.clash_runtime import (
    build_clash_resume_inputs,
    build_clash_start_inputs,
    clash_resume_payload,
    clash_thread_config,
    get_clash_graph,
    statics_from_start_inputs,
)

_MOCK_CASES_PATH = REPO_ROOT / "data" / "clash_mock_cases.json"
_sessions: Dict[str, ClashSession] = {}
_graph_snapshots: Dict[str, Dict[str, Any]] = {}
clash_graph = get_clash_graph()


def _load_mock_cases_from_file() -> List[ClashMockCase]:
    if not _MOCK_CASES_PATH.exists():
        return []
    raw = json.loads(_MOCK_CASES_PATH.read_text(encoding="utf-8"))
    return [ClashMockCase(**item) for item in raw]


def _load_mock_cases_from_supabase() -> List[ClashMockCase]:
    try:
        import backend.database.supabase_db as supabase_db

        rows = supabase_db.get_active_clash_mock_cases()
        return [ClashMockCase(**row) for row in rows]
    except Exception as exc:
        print(f"Clash mock cases DB fallback to JSON: {exc}")
        return []


def _load_mock_cases() -> List[ClashMockCase]:
    cases = _load_mock_cases_from_supabase()
    if cases:
        return cases
    return _load_mock_cases_from_file()


def get_mock_cases() -> List[ClashMockCase]:
    return _load_mock_cases()


def get_mock_case(case_id: str) -> Optional[ClashMockCase]:
    for c in _load_mock_cases():
        if c.id == case_id:
            return c
    return None


def create_session(payload: ClashSessionCreate) -> ClashSession:
    sid = f"clash_{uuid.uuid4().hex[:16]}"
    role = payload.user_role or "prosecution"
    if role not in ("prosecution", "defence"):
        role = "prosecution"
    session = ClashSession(
        session_id=sid,
        mode=payload.mode,
        user_id=payload.user_id,
        user_role=role,
        status="created",
    )
    _sessions[sid] = session
    return session


def get_session(session_id: str) -> Optional[ClashSession]:
    return _sessions.get(session_id)


def attach_case(session_id: str, case: ClashCaseInput) -> ClashSession:
    session = _sessions.get(session_id)
    if not session:
        raise ValueError("Session not found")

    title = case.title
    facts = case.facts

    if case.mock_case_id:
        mock = get_mock_case(case.mock_case_id)
        if mock:
            title = mock.title
            facts = mock.facts
        session.mock_case_id = case.mock_case_id

    session.case_title = title
    session.case_facts = facts
    session.status = "case_ready"
    _sessions[session_id] = session
    return session


def _thread_config(session_id: str, *, inputs: Optional[dict] = None) -> dict:
    statics = statics_from_start_inputs(inputs) if inputs else None
    return clash_thread_config(f"clash-{session_id}", statics=statics)


def _emit(
    event_type: str,
    session: ClashSession,
    *,
    agent_side: str = "system",
    phase: Optional[str] = None,
    content: Optional[str] = None,
    payload: Optional[dict] = None,
) -> str:
    line = {
        "event_type": event_type,
        "session_id": session.session_id,
        "mode": session.mode.value,
        "agent_side": agent_side,
        "phase": phase,
        "content": content,
        "payload": payload or {},
    }
    return json.dumps(line) + "\n"


def _chunk_emit_argument(
    session: ClashSession,
    *,
    agent_side: str,
    phase_str: Optional[str],
    argument: str,
) -> List[str]:
    lines: List[str] = []
    if not argument.strip():
        return lines
    chunk_size = 14
    for i in range(0, len(argument), chunk_size):
        lines.append(
            _emit(
                "stream_token",
                session,
                agent_side=agent_side,
                phase=phase_str,
                content=argument[i : i + chunk_size],
            )
        )
    return lines


def _emit_agent_turn(
    session: ClashSession,
    *,
    name: str,
    output: dict,
    phase_str: Optional[str],
) -> List[str]:
    """Emit reasoning steps then streamed argument for prosecution/defence."""
    lines: List[str] = []
    agent_side = "prosecution" if name == "prosecution" else "defence"
    reasoning_key = f"{name}_reasoning"
    law_key = f"{name}_law_sections"

    reasoning = output.get(reasoning_key) or []
    law_sections = output.get(law_key) or []
    argument = (
        output.get("prosecution_output")
        if name == "prosecution"
        else output.get("defence_output")
    ) or ""

    # Task 9: prefer transcript-derived fields when top-level mirrors are empty
    if not reasoning or not argument or not law_sections:
        tr_r, tr_l, tr_a = latest_side_fields_from_transcript(
            list(output.get("transcript_entries") or []), agent_side
        )
        if not reasoning:
            reasoning = tr_r
        if not argument:
            argument = tr_a
        if not law_sections:
            law_sections = tr_l

    if not reasoning and not argument:
        return lines

    if not reasoning or not argument:
        raw = argument or ""
        parsed = parse_agent_response(raw)
        if not reasoning:
            reasoning = parsed.get("reasoning_steps") or []
        if not argument:
            argument = (parsed.get("argument") or "").strip()
        if not law_sections:
            law_sections = parsed.get("law_sections") or []

    reasoning, argument = normalize_counsel_voice(agent_side, reasoning, argument or "")
    if not (argument or "").strip() and reasoning:
        last = str(reasoning[-1])
        argument = last.split(":", 1)[-1].strip() if ":" in last else last.strip()

    for idx, step in enumerate(reasoning):
        if not str(step).strip():
            continue
        lines.append(
            _emit(
                "reasoning_step",
                session,
                agent_side=agent_side,
                phase=phase_str,
                content=str(step).strip(),
                payload={
                    "index": idx,
                    "law_sections": law_sections,
                },
            )
        )

    if argument.strip():
        lines.append(
            _emit(
                "stream_start",
                session,
                agent_side=agent_side,
                phase=phase_str,
                payload={"node": name, "structured": True},
            )
        )
        lines.extend(
            _chunk_emit_argument(
                session, agent_side=agent_side, phase_str=phase_str, argument=argument
            )
        )
        lines.append(
            _emit(
                "stream_end",
                session,
                agent_side=agent_side,
                phase=phase_str,
                content=argument,
                payload={"finalize_only": False, "node": name},
            )
        )
    return lines


def _sync_session_from_output(session: ClashSession, output: dict) -> None:
    if output.get("phase"):
        try:
            session.phase = ClashPhase(output["phase"])
        except ValueError:
            pass
    session.round_number = int(output.get("round_number") or session.round_number or 0)

    if output.get("awaiting_user_input"):
        session.status = "paused"
        session.pending_question = output.get("pending_question")
        session.pending_question_id = output.get("pending_question_id")
        session.question_agent_side = output.get("question_agent_side")
        session.user_action = output.get("user_action")
        session.ai_assist_allowed = bool(output.get("ai_assist_allowed"))
        session.question_target = output.get("question_target")
    elif "awaiting_user_input" in output and not output.get("awaiting_user_input"):
        # Clear pause fields when debate continues
        session.pending_question = None
        session.pending_question_id = None
        session.user_action = None
        session.ai_assist_allowed = False
        session.question_target = None
        if session.status == "paused":
            session.status = "debating"

    if output.get("final_result"):
        session.status = "completed"
        fr = output["final_result"]
        w = str(fr.get("declared_winner") or "draw").lower()
        winner = (
            "prosecution"
            if w in ("prosecution", "complainant")
            else "defence"
            if w in ("defence", "defense", "defendant")
            else "draw"
        )
        session.final_result = FinalClashResult(
            overall_score=float(fr.get("overall_score", 0)),
            confidence_band=str(fr.get("confidence_band", "medium")),
            mock_verdict=str(fr.get("mock_verdict", "")),
            declared_winner=winner,
            winner_explanation=str(
                fr.get("winner_explanation") or fr.get("mock_verdict") or ""
            ),
            actionability_notes=str(fr.get("actionability_notes", "")),
            evidence_gaps=fr.get("evidence_gaps") or [],
            unresolved_questions=fr.get("unresolved_questions") or [],
            round_scores=[
                JudgeScore.from_dict(r) for r in (fr.get("round_scores") or [])
            ],
            judge_parameters=fr.get("judge_parameters") or [],
            parameter_totals=[
                ParameterScore(
                    parameter_id=str(p.get("parameter_id", "")),
                    parameter_label=str(p.get("parameter_label", "")),
                    prosecution_score=float(p.get("prosecution_score", 0)),
                    defence_score=float(p.get("defence_score", 0)),
                    winner=p.get("winner", "draw"),
                    rationale=str(p.get("rationale", "")),
                )
                if isinstance(p, dict)
                else p
                for p in (fr.get("parameter_totals") or [])
            ],
            prosecution_overall_average=float(fr.get("prosecution_overall_average", 0)),
            defence_overall_average=float(fr.get("defence_overall_average", 0)),
        )
    elif session.status not in ("paused", "completed"):
        session.status = "debating"

    prev = _graph_snapshots.get(session.session_id) or {}
    # Allow explicit None to clear pause / one-shot flags
    _clearable = {
        "pending_question",
        "pending_question_id",
        "question_agent_side",
        "question_target",
        "answering_side",
        "user_action",
        "resume_node",
        "resumed_answer",
        "force_ai",
        "user_provided_argument_side",
        "user_provided_question",
        "user_provided_answer",
        "cross_exam_stage",
        "pending_rag_citations",
        "pending_law_sections",
        "pending_reasoning_steps",
        "ai_assist_allowed",
        "resumed_delegate",
        "counsel_error",
    }
    _append_keys = {
        "user_answers",
        "asked_questions",
        "transcript_entries",
        "logic_log",
        "round_scores",
    }
    merged = {**prev}
    for k, v in output.items():
        if k in _append_keys and isinstance(v, list):
            merged[k] = list(prev.get(k) or []) + list(v)
        elif v is not None or k in _clearable:
            merged[k] = v
    # Always preserve accumulated lists when a node omits them
    for key in (
        "user_answers",
        "asked_questions",
        "transcript_entries",
        "logic_log",
        "round_scores",
        "rag_cache",
        "judge_parameters",
    ):
        if key not in output and prev.get(key):
            merged[key] = prev[key]
    # Preserve sticky role/mode fields
    for key in ("user_role", "mode", "case_title", "case_facts", "session_id", "user_id"):
        if merged.get(key) is None and prev.get(key) is not None:
            merged[key] = prev[key]
        if merged.get(key) is None and getattr(session, key, None) is not None:
            merged[key] = getattr(session, key)
    _graph_snapshots[session.session_id] = merged
    _sessions[session.session_id] = session


async def stream_debate(
    session_id: str,
    *,
    resume_answer: Optional[str] = None,
    resume_delegate: bool = False,
) -> AsyncGenerator[str, None]:
    session = _sessions.get(session_id)
    if not session:
        yield _emit("error", ClashSession(session_id=session_id, mode=ClashMode.practice), content="Session not found")
        return

    if not session.case_facts:
        yield _emit("error", session, content="Case not submitted")
        return

    session.status = "debating"

    start_inputs: Dict[str, Any] = build_clash_start_inputs(
        mode=session.mode,
        user_role=session.user_role,
        case_title=session.case_title,
        case_facts=session.case_facts,
        mock_case_id=session.mock_case_id,
        session_id=session_id,
        user_id=session.user_id,
    )
    config = _thread_config(session_id, inputs=start_inputs)

    is_resume = resume_answer is not None or resume_delegate
    if is_resume and CLASH_EFFICIENCY_V2:
        inputs: Any = clash_resume_payload(
            answer=resume_answer,
            delegate=resume_delegate,
        )
        session.status = "debating"
        label = "Counsel will handle this turn…" if resume_delegate else (resume_answer or "")
        snap = _graph_snapshots.get(session_id, {})
        yield _emit(
            "user_answer_received",
            session,
            agent_side=snap.get("question_agent_side") or session.question_agent_side or "system",
            phase=snap.get("phase") or (session.phase.value if session.phase else None),
            content=label,
            payload={
                "question_id": snap.get("pending_question_id") or session.pending_question_id,
                "delegate": resume_delegate,
                "user_action": snap.get("user_action") or session.user_action,
                "user_role": session.user_role,
            },
        )
    else:
        inputs = dict(start_inputs)
        snapshot = _graph_snapshots.get(session_id)
        if snapshot and not CLASH_EFFICIENCY_V2:
            inputs["next_step"] = snapshot.get("next_step")
            inputs["phase"] = snapshot.get("phase")
            inputs["phase_index"] = snapshot.get("phase_index")
            inputs["round_number"] = snapshot.get("round_number")
            inputs["round_scores"] = snapshot.get("round_scores")
            inputs["transcript_entries"] = snapshot.get("transcript_entries")
            inputs["logic_log"] = snapshot.get("logic_log")
            for key in (
                "user_answers",
                "asked_questions",
                "prosecution_output",
                "defence_output",
                "messages",
                "question_target",
                "answering_side",
                "resume_node",
                "user_action",
                "ai_assist_allowed",
                "cross_exam_stage",
                "rag_cache",
                "judge_parameters",
                "force_ai",
                "user_role",
            ):
                if snapshot.get(key) is not None:
                    inputs[key] = snapshot[key]

        if is_resume:
            snap = _graph_snapshots.get(session_id, {})
            inputs.update(
                build_clash_resume_inputs(
                    answer=resume_answer,
                    delegate=resume_delegate,
                )
            )
            inputs["pending_question"] = snap.get("pending_question") or session.pending_question
            inputs["pending_question_id"] = snap.get("pending_question_id") or session.pending_question_id
            inputs["question_agent_side"] = snap.get("question_agent_side") or session.question_agent_side
            inputs["question_target"] = snap.get("question_target") or session.question_target
            inputs["answering_side"] = snap.get("answering_side")
            inputs["user_action"] = snap.get("user_action") or session.user_action
            inputs["ai_assist_allowed"] = snap.get("ai_assist_allowed", session.ai_assist_allowed)
            inputs["cross_exam_stage"] = snap.get("cross_exam_stage")
            inputs["resume_node"] = snap.get("resume_node") or session.question_agent_side
            session.status = "debating"
            label = "Counsel will handle this turn…" if resume_delegate else (resume_answer or "")
            yield _emit(
                "user_answer_received",
                session,
                agent_side=inputs.get("question_agent_side") or "system",
                phase=inputs.get("phase"),
                content=label,
                payload={
                    "question_id": inputs.get("pending_question_id"),
                    "delegate": resume_delegate,
                    "user_action": inputs.get("user_action"),
                    "user_role": session.user_role,
                },
            )

    current_side: Optional[str] = None
    current_phase: Optional[str] = None
    accumulated = ""
    ended_stream_nodes: set[str] = set()

    yield _emit(
        "phase_start",
        session,
        agent_side="system",
        phase=session.phase.value if session.phase else "opening",
        content="Debate started — opening arguments.",
        payload={"status": "debate_started"},
    )

    try:
        async for event in clash_graph.astream_events(inputs, config=config, version="v2"):
            kind = event.get("event")
            name = event.get("name", "")

            if kind == "on_chain_start":
                if name == "final_judge":
                    yield _emit(
                        "phase_start",
                        session,
                        agent_side="judge",
                        phase="closing",
                        content="Final judgment…",
                        payload={"node": name},
                    )
                elif name == "incorporate_answer":
                    yield _emit(
                        "phase_start",
                        session,
                        agent_side="system",
                        content="Answer recorded — debate continues…",
                        payload={"node": name},
                    )
                if name == "preprocess":
                    yield _emit(
                        "phase_start",
                        session,
                        agent_side="system",
                        content="Evaluation parameters for this debate…",
                        payload={"node": name},
                    )
                if name in CLASH_STREAM_NODES:
                    current_side = name
                    accumulated = ""
                    agent_side = "prosecution" if name == "prosecution" else "defence"
                    phase = _graph_snapshots.get(session_id, {}).get("phase") or session.phase
                    phase_str = phase.value if hasattr(phase, "value") else str(phase) if phase else None
                    current_phase = phase_str
                    side_label = "Prosecution" if agent_side == "prosecution" else "Defence"
                    yield _emit(
                        "phase_start",
                        session,
                        agent_side=agent_side,
                        phase=phase_str,
                        content=f"{side_label} — {str(phase_str or 'opening').replace('_', ' ')}…",
                        payload={"node": name},
                    )

            elif kind == "on_chat_model_stream":
                # Structured JSON turns are emitted at chain_end via _emit_agent_turn.
                continue

            elif kind == "on_chain_end":
                raw_output = event.get("data", {}).get("output")
                if isinstance(raw_output, dict):
                    output = raw_output
                else:
                    output = {}
                if name == "preprocess" and isinstance(output, dict):
                    params = output.get("judge_parameters") or []
                    yield _emit(
                        "parameters_announced",
                        session,
                        agent_side="judge",
                        content="The Court will score each phase on the following parameters:",
                        payload={"parameters": params},
                    )

                if name in CLASH_STREAM_NODES and isinstance(output, dict):
                    phase = output.get("phase") or _graph_snapshots.get(session_id, {}).get("phase") or session.phase
                    phase_str = phase.value if hasattr(phase, "value") else str(phase) if phase else None
                    end_key = f"{name}:{phase_str}"
                    if end_key not in ended_stream_nodes:
                        ended_stream_nodes.add(end_key)
                        for line in _emit_agent_turn(
                            session, name=name, output=output, phase_str=phase_str
                        ):
                            yield line
                    accumulated = ""
                    current_side = None

                if isinstance(output, dict):
                    _sync_session_from_output(session, output)

                    citations = output.get("pending_rag_citations") or []
                    if citations and name in (
                        "prosecution",
                        "defence",
                        "ai_cross_answer",
                        "defence_cross_answer",
                        "cross_exam",
                        "judge_round",
                        "final_judge",
                    ):
                        yield _emit(
                            "rag_retrieved",
                            session,
                            agent_side=(
                                "judge"
                                if name in ("judge_round", "final_judge")
                                else (
                                    output.get("cross_answer_side")
                                    or (
                                        "prosecution"
                                        if name == "prosecution"
                                        else "defence"
                                        if name == "defence"
                                        else output.get("question_agent_side")
                                        or "system"
                                    )
                                )
                            ),
                            phase=output.get("phase")
                            or (session.phase.value if session.phase else None),
                            payload={"citations": citations},
                        )

                    if name == "ai_cross_answer" or name == "defence_cross_answer":
                        q_phase = output.get("phase") or (
                            session.phase.value if session.phase else None
                        )
                        answer_side = output.get("cross_answer_side") or "defence"
                        for idx, step in enumerate(
                            [
                                e
                                for e in (output.get("transcript_entries") or [])
                                if isinstance(e, dict)
                                and e.get("kind") == "reasoning"
                                and e.get("side") == answer_side
                            ][-4:]
                        ):
                            if str(step.get("content", "")).strip():
                                yield _emit(
                                    "reasoning_step",
                                    session,
                                    agent_side=answer_side,
                                    phase=q_phase,
                                    content=str(step["content"]).strip(),
                                    payload={"index": idx},
                                )
                        answer_text = output.get("cross_answer_text") or ""
                        if answer_text:
                            yield _emit(
                                "cross_answer",
                                session,
                                agent_side=answer_side,
                                phase=q_phase,
                                content=answer_text,
                                payload={
                                    "question_id": output.get("cross_answer_id"),
                                    "question_target": answer_side,
                                },
                            )

                    # Informational: AI asked a question that will be answered by AI
                    q_target = output.get("question_target")
                    if (
                        output.get("pending_question")
                        and q_target in ("prosecution", "defence")
                        and not output.get("awaiting_user_input")
                        and name == "cross_exam"
                    ):
                        q_phase = output.get("phase") or (
                            session.phase.value if session.phase else None
                        )
                        law_sections = output.get("pending_law_sections") or []
                        yield _emit(
                            "question_request",
                            session,
                            agent_side=output.get("question_agent_side") or "prosecution",
                            phase=q_phase,
                            content=output.get("pending_question"),
                            payload={
                                "question_id": output.get("pending_question_id"),
                                "question_target": q_target,
                                "user_action": None,
                                "ai_assist_allowed": False,
                                "quick_replies": [],
                                "law_sections": law_sections,
                            },
                        )

                    if output.get("counsel_error"):
                        yield _emit("error", session, content=str(output["counsel_error"]))
                        session.status = "error"
                        return

                    if output.get("awaiting_user_input") and output.get("pending_question"):
                        q_phase = output.get("phase") or (
                            session.phase.value if session.phase else None
                        )
                        q_side = output.get("question_agent_side") or "system"
                        law_sections = output.get("pending_law_sections") or []
                        user_action = output.get("user_action") or "answer"
                        assist = bool(output.get("ai_assist_allowed"))
                        q_target_out = output.get("question_target") or "user"
                        # Normalize: frontend treats pause targets as needing user input
                        if q_target_out in ("prosecution", "defence"):
                            display_target = "user"
                        else:
                            display_target = "user"
                        reasoning = output.get("pending_reasoning_steps") or []
                        for idx, step in enumerate(reasoning):
                            if str(step).strip() and q_side in ("prosecution", "defence"):
                                yield _emit(
                                    "reasoning_step",
                                    session,
                                    agent_side=q_side,
                                    phase=q_phase,
                                    content=str(step).strip(),
                                    payload={
                                        "index": idx,
                                        "law_sections": law_sections,
                                    },
                                )
                        yield _emit(
                            "question_request",
                            session,
                            agent_side=q_side if q_side in ("prosecution", "defence", "judge") else "system",
                            phase=q_phase,
                            content=output.get("pending_question"),
                            payload={
                                "question_id": output.get("pending_question_id"),
                                "question_target": display_target,
                                "party_target": q_target_out,
                                "user_action": user_action,
                                "ai_assist_allowed": assist,
                                "user_role": session.user_role,
                                "quick_replies": [],
                                "law_sections": law_sections,
                            },
                        )
                        return

                    if name == "judge_round" and output.get("round_scores"):
                        latest = output["round_scores"][-1]
                        yield _emit(
                            "round_complete",
                            session,
                            agent_side="judge",
                            phase=latest.get("phase"),
                            payload={"scores": latest},
                        )

                    if name == "final_judge" and output.get("final_result"):
                        fr = output["final_result"]
                        explanation = str(
                            fr.get("winner_explanation") or fr.get("mock_verdict") or ""
                        )
                        if explanation:
                            yield _emit(
                                "judge_verdict_start",
                                session,
                                agent_side="judge",
                                phase=ClashPhase.closing.value,
                                payload={"declared_winner": fr.get("declared_winner")},
                            )
                            chunk_size = 18
                            for i in range(0, len(explanation), chunk_size):
                                yield _emit(
                                    "judge_verdict_token",
                                    session,
                                    agent_side="judge",
                                    phase=ClashPhase.closing.value,
                                    content=explanation[i : i + chunk_size],
                                )
                            yield _emit(
                                "judge_verdict_end",
                                session,
                                agent_side="judge",
                                phase=ClashPhase.closing.value,
                                content=explanation,
                            )
                        yield _emit(
                            "final_result",
                            session,
                            agent_side="judge",
                            phase=ClashPhase.closing.value,
                            payload=fr,
                        )

        # V2 interrupt path: map GraphInterrupt payload → question_request
        if CLASH_EFFICIENCY_V2 and session.status not in ("completed", "error"):
            try:
                snap = await clash_graph.aget_state(config)
            except Exception:
                snap = None
            payload = interrupt_payload_from_graph_state(snap)
            if payload and payload.get("pending_question"):
                _sync_session_from_output(session, {**payload, "awaiting_user_input": True})
                q_phase = payload.get("phase") or (
                    session.phase.value if session.phase else None
                )
                q_side = payload.get("question_agent_side") or "system"
                law_sections = payload.get("pending_law_sections") or []
                user_action = payload.get("user_action") or "answer"
                assist = bool(payload.get("ai_assist_allowed"))
                q_target_out = payload.get("question_target") or "user"
                reasoning = payload.get("pending_reasoning_steps") or []
                for idx, step in enumerate(reasoning):
                    if str(step).strip() and q_side in ("prosecution", "defence"):
                        yield _emit(
                            "reasoning_step",
                            session,
                            agent_side=q_side,
                            phase=q_phase,
                            content=str(step).strip(),
                            payload={"index": idx, "law_sections": law_sections},
                        )
                yield _emit(
                    "question_request",
                    session,
                    agent_side=q_side if q_side in ("prosecution", "defence", "judge") else "system",
                    phase=q_phase,
                    content=payload.get("pending_question"),
                    payload={
                        "question_id": payload.get("pending_question_id"),
                        "question_target": "user",
                        "party_target": q_target_out,
                        "user_action": user_action,
                        "ai_assist_allowed": assist,
                        "user_role": session.user_role,
                        "quick_replies": [],
                        "law_sections": law_sections,
                    },
                )
                return

    except Exception as e:
        import traceback

        # Interrupt is a normal pause in V2 — surface as question_request
        err_name = type(e).__name__
        if CLASH_EFFICIENCY_V2 and "Interrupt" in err_name:
            try:
                snap = await clash_graph.aget_state(config)
                payload = interrupt_payload_from_graph_state(snap)
                if payload and payload.get("pending_question"):
                    _sync_session_from_output(session, {**payload, "awaiting_user_input": True})
                    yield _emit(
                        "question_request",
                        session,
                        agent_side=payload.get("question_agent_side") or "system",
                        phase=payload.get("phase"),
                        content=payload.get("pending_question"),
                        payload={
                            "question_id": payload.get("pending_question_id"),
                            "question_target": "user",
                            "party_target": payload.get("question_target"),
                            "user_action": payload.get("user_action") or "answer",
                            "ai_assist_allowed": bool(payload.get("ai_assist_allowed")),
                            "user_role": session.user_role,
                            "quick_replies": [],
                            "law_sections": payload.get("pending_law_sections") or [],
                        },
                    )
                    return
            except Exception:
                pass

        traceback.print_exc()
        session.status = "error"
        yield _emit("error", session, content=str(e))


async def stream_answer(session_id: str, body: ClashAnswerRequest) -> AsyncGenerator[str, None]:
    session = _sessions.get(session_id)
    if not session:
        yield _emit("error", ClashSession(session_id=session_id, mode=ClashMode.practice), content="Session not found")
        return

    if body.question_id and session.pending_question_id and body.question_id != session.pending_question_id:
        yield _emit("error", session, content="Question ID mismatch")
        return

    if body.delegate:
        async for line in stream_debate(session_id, resume_answer="", resume_delegate=True):
            yield line
        return

    async for line in stream_debate(session_id, resume_answer=body.answer or ""):
        yield line
