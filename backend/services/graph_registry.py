"""Dynamic LangGraph registry with topology introspection and test runners."""
from __future__ import annotations

import importlib
import json
import os
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured
from backend.services.clash_runtime import (
    build_clash_resume_inputs,
    build_clash_start_inputs,
    clash_resume_payload,
    clash_thread_config,
    get_clash_graph,
    statics_from_start_inputs,
)

SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "api_key",
    "secret",
}

DEFAULT_GRAPHS = [
    {
        "graph_id": "chat_agent",
        "display_name": "Chat Agent Graph",
        "module_path": "backend.agent_graph",
        "graph_attr": "agent_graph",
    },
    {
        "graph_id": "clash_agent",
        "display_name": "Clash Mode Graph",
        "module_path": "backend.clash_graph",
        "graph_attr": "clash_graph",
    },
]

_VERSION = os.getenv("LANGGRAPH_VERSION") or os.getenv("GIT_SHA") or "dev"


def _sanitize(value: Any, depth: int = 0, max_chars: int = 8000) -> Any:
    if depth > 6:
        return "<max-depth>"
    if callable(value) and not isinstance(value, (str, bytes)):
        return f"<callable:{getattr(value, '__name__', type(value).__name__)}>"
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key = str(k)
            if key.lower() in SENSITIVE_KEYS or any(s in key.lower() for s in ("password", "token", "secret")):
                out[key] = "<redacted>"
            else:
                out[key] = _sanitize(v, depth + 1, max_chars)
        text = json.dumps(out, default=str)
        if len(text) > max_chars:
            return {"_truncated": text[:max_chars], "_truncated": True}
        return out
    if isinstance(value, (list, tuple)):
        items = [_sanitize(v, depth + 1, max_chars) for v in list(value)[:50]]
        if len(value) > 50:
            items.append(f"<+{len(value) - 50} more>")
        return items
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, str) and len(value) > max_chars:
            return value[:max_chars] + "…<truncated>"
        return value
    text = str(value)
    if len(text) > max_chars:
        return text[:max_chars] + "…<truncated>"
    return text


_SKIP_EVENT_NODES = {
    "LangGraph",
    "RunnableSequence",
    "RunnableLambda",
    "RunnableParallel",
    "RunnableAssign",
    "ChannelWrite",
    "ChannelRead",
    "_write",
    "__start__",
    "__end__",
}


def _is_graph_node_boundary(event: dict[str, Any]) -> bool:
    """Only record the compiled graph node's own start/end — not nested LLM/tool chains."""
    name = str(event.get("name") or "")
    metadata = event.get("metadata") or {}
    lg_node = metadata.get("langgraph_node")
    if not lg_node:
        return False
    lg_node = str(lg_node)
    if lg_node in _SKIP_EVENT_NODES or name in _SKIP_EVENT_NODES:
        return False
    # Nested runnables inherit langgraph_node but keep their own name (e.g. ChatOpenAI).
    return name == lg_node


def _load_compiled(module_path: str, graph_attr: str):
    module = importlib.import_module(module_path)
    graph = getattr(module, graph_attr)
    return graph


def introspect_topology(compiled_graph) -> dict[str, Any]:
    """Derive nodes/edges from a compiled LangGraph without hardcoding names."""
    try:
        g = compiled_graph.get_graph(xray=True)
    except TypeError:
        g = compiled_graph.get_graph()

    nodes = []
    node_ids = []
    raw_nodes = getattr(g, "nodes", {}) or {}
    if isinstance(raw_nodes, dict):
        for node_id, node_data in raw_nodes.items():
            nid = str(node_id)
            node_ids.append(nid)
            nodes.append(
                {
                    "id": nid,
                    "label": nid,
                    "data": _sanitize(getattr(node_data, "data", None) or {}),
                }
            )
    else:
        for node_id in list(raw_nodes):
            nid = str(node_id)
            node_ids.append(nid)
            nodes.append({"id": nid, "label": nid})

    edges = []
    raw_edges = getattr(g, "edges", []) or []
    for edge in raw_edges:
        # networkx-like Edge or tuple
        source = getattr(edge, "source", None) or (edge[0] if isinstance(edge, (list, tuple)) and edge else None)
        target = getattr(edge, "target", None) or (edge[1] if isinstance(edge, (list, tuple)) and len(edge) > 1 else None)
        if source is None or target is None:
            continue
        data = getattr(edge, "data", None) or {}
        conditional = bool(getattr(edge, "conditional", False))
        if isinstance(data, dict) and data.get("conditional") is not None:
            conditional = bool(data.get("conditional"))
        edges.append(
            {
                "id": f"{source}->{target}",
                "source": str(source),
                "target": str(target),
                "conditional": conditional,
            }
        )

    entry = None
    try:
        candidate = getattr(compiled_graph, "first_entry", None)
        if callable(candidate):
            candidate = candidate()
        if candidate is None:
            candidate = getattr(g, "first_node", None)
            if callable(candidate):
                candidate = candidate()
        if isinstance(candidate, str):
            entry = candidate
        elif candidate is not None:
            entry = str(getattr(candidate, "id", candidate))
    except Exception:
        entry = None
    if not entry and nodes:
        # Prefer __start__ target if present
        for e in edges:
            if e["source"] in {"__start__", "START", "start"}:
                entry = e["target"]
                break
        if not entry:
            entry = nodes[0]["id"]
    if entry is not None and not isinstance(entry, str):
        entry = str(entry)

    orphans = []
    connected = {e["source"] for e in edges} | {e["target"] for e in edges}
    for n in node_ids:
        if n.startswith("__"):
            continue
        if n not in connected and n != entry:
            orphans.append(n)

    return {
        "nodes": nodes,
        "edges": edges,
        "entry_node": entry,
        "orphans": orphans,
        "node_count": len(nodes),
        "edge_count": len(edges),
    }


def list_registered_graphs(refresh: bool = True) -> list[dict[str, Any]]:
    results = []
    for spec in DEFAULT_GRAPHS:
        try:
            compiled = _load_compiled(spec["module_path"], spec["graph_attr"])
            topology = introspect_topology(compiled)
            version = _VERSION
            if refresh and is_postgres_configured():
                execute_void(
                    """
                    INSERT INTO langgraph_graph_versions (
                      graph_id, version, display_name, module_path, graph_attr, entry_node, topology, is_active
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, true)
                    ON CONFLICT (graph_id, version) DO UPDATE SET
                      topology = EXCLUDED.topology,
                      entry_node = EXCLUDED.entry_node,
                      is_active = true,
                      display_name = EXCLUDED.display_name
                    """,
                    (
                        spec["graph_id"],
                        version,
                        spec["display_name"],
                        spec["module_path"],
                        spec["graph_attr"],
                        topology.get("entry_node"),
                        json.dumps(topology, default=str),
                    ),
                )
            results.append(
                {
                    **spec,
                    "version": version,
                    "topology": topology,
                    "integrity": {
                        "orphan_nodes": topology.get("orphans") or [],
                        "ok": not bool(topology.get("orphans")),
                    },
                }
            )
        except Exception as e:
            results.append({**spec, "error": str(e), "version": _VERSION})
    return results


def get_graph_metadata(graph_id: str) -> dict[str, Any]:
    graphs = list_registered_graphs(refresh=True)
    for g in graphs:
        if g.get("graph_id") == graph_id:
            return g
    raise ValueError(f"Unknown graph: {graph_id}")


def user_facing_stream_nodes(graph_id: str = "chat_agent") -> set[str]:
    """Dynamic allowlist for chat token streaming.

    Includes every graph node except orchestration/handoff internals so newly
    added specialist nodes stream automatically without code changes.
    """
    meta = get_graph_metadata(graph_id)
    topology = meta.get("topology") or {}
    nodes = topology.get("nodes") or []
    excluded = {
        "supervisor",
        "plan_runner",
        "report_generator",
        "suggested_actions",
        "question_processor",
        "sahayak",
        "legal_moderator",
        "lawyer_forwarder",
        "nodal_guide",
        "scam_match",
        "__start__",
        "__end__",
        "START",
        "END",
    }
    return {n["id"] for n in nodes if n.get("id") and n["id"] not in excluded}


async def create_and_run_test(
    graph_id: str,
    query: str,
    initial_state: Optional[dict] = None,
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    meta = get_graph_metadata(graph_id)
    if meta.get("error"):
        raise RuntimeError(meta["error"])
    compiled = (
        get_clash_graph()
        if graph_id == "clash_agent"
        else _load_compiled(meta["module_path"], meta["graph_attr"])
    )
    topology = meta.get("topology") or {}
    version = meta.get("version") or _VERSION
    run_id = str(uuid.uuid4())
    state = dict(initial_state or {})
    if graph_id == "chat_agent":
        from langchain_core.messages import HumanMessage

        state.setdefault("user_query", query)
        # Must be LangChain messages — plain dicts break llm.invoke (.content)
        if "messages" not in state:
            state["messages"] = [HumanMessage(content=query)]
        state.setdefault("query", query)
        # Pin original incident text so Q&A answers never become the "case"
        state.setdefault("user_statement", query)
        # Ensure location from presets / tester lands in user_details too
        loc = state.get("location")
        ud = dict(state.get("user_details") or {})
        if loc and not ud.get("location"):
            ud["location"] = loc
        ud.setdefault("user_id", "admin-test")
        ud.setdefault("session_id", f"admin-test-{run_id}")
        state["user_details"] = ud
        state.setdefault(
            "context",
            {
                "user_id": "admin-test",
                "session_id": f"admin-test-{run_id}",
                "query": query,
            },
        )
    elif graph_id == "clash_agent":
        state = build_clash_start_inputs(
            mode=state.get("mode"),
            user_role=state.get("user_role"),
            case_title=state.get("case_title"),
            case_facts=state.get("case_facts"),
            mock_case_id=state.get("mock_case_id"),
            session_id=str(state.get("session_id") or f"admin-clash-{run_id}"),
            user_id=str(state.get("user_id") or created_by or "admin-test"),
            query_fallback=query,
            base_state=state,
        )

    if is_postgres_configured():
        execute_void(
            """
            INSERT INTO langgraph_runs (
              id, graph_id, graph_version, status, query, initial_state, topology_snapshot, created_by, started_at
            ) VALUES (%s, %s, %s, 'running', %s, %s::jsonb, %s::jsonb, %s, now())
            """,
            (
                run_id,
                graph_id,
                version,
                query,
                json.dumps(_sanitize(state), default=str),
                json.dumps(topology, default=str),
                created_by,
            ),
        )

    try:
        config = (
            clash_thread_config(
                _thread_id_for_run(run_id),
                statics=statics_from_start_inputs(state),
            )
            if graph_id == "clash_agent"
            else {"configurable": {"thread_id": _thread_id_for_run(run_id)}}
        )
        path, final_state, final_config = await _stream_and_record(compiled, state, config, run_id, path_seed=[])
        awaiting = extract_awaiting_input(final_state or {}, path, graph_snapshot=None)
        try:
            snap = compiled.get_state(config)
            awaiting = extract_awaiting_input(
                getattr(snap, "values", None) or final_state or {},
                path,
                graph_snapshot=snap,
            )
            # Persist interrupt fields onto final_state for admin UI
            from backend.agents.clash.pause import interrupt_payload_from_graph_state

            ip = interrupt_payload_from_graph_state(snap)
            if ip and isinstance(final_state, dict):
                final_state = {**final_state, **ip, "awaiting_user_input": True}
            elif ip:
                final_state = {**(final_state if isinstance(final_state, dict) else {}), **ip, "awaiting_user_input": True}
        except Exception:
            pass
        status = "awaiting_input" if awaiting.get("awaiting") else "completed"
        if is_postgres_configured():
            execute_void(
                """
                UPDATE langgraph_runs
                SET status = %s, final_state = %s::jsonb, path = %s::jsonb,
                    checkpoint_config = %s::jsonb, finished_at = now()
                WHERE id = %s
                """,
                (
                    status,
                    json.dumps(_sanitize(final_state), default=str),
                    json.dumps(path),
                    json.dumps(_checkpoint_config(final_config), default=str),
                    run_id,
                ),
            )
    except Exception as exc:
        error = f"{exc}\n{traceback.format_exc()}"
        if is_postgres_configured():
            execute_void(
                """
                UPDATE langgraph_runs
                SET status = 'failed', error = %s, finished_at = now()
                WHERE id = %s
                """,
                (error, run_id),
            )
        raise

    return get_run(run_id)


async def _stream_and_record(
    compiled,
    state: Optional[dict],
    config: dict,
    run_id: str,
    path_seed: Optional[list[str]] = None,
) -> tuple[list[str], Any, dict]:
    """Stream graph events, persist node traces, return path + sanitized final state."""
    path: list[str] = list(path_seed or [])
    seq_row = execute_one(
        "SELECT COALESCE(MAX(sequence_no), 0) AS m FROM langgraph_node_events WHERE run_id = %s",
        (run_id,),
    ) if is_postgres_configured() else None
    seq = int((seq_row or {}).get("m") or 0)
    node_starts: dict[str, float] = {}
    final_state = None
    final_config = config

    async for event in compiled.astream_events(state, config=config, version="v2"):
        kind = event.get("event")
        if kind not in {"on_chain_start", "on_chain_end", "on_chain_error"}:
            continue
        if not _is_graph_node_boundary(event):
            continue

        metadata = event.get("metadata") or {}
        tags = event.get("tags") or []
        node = str(metadata.get("langgraph_node") or event.get("name") or "")
        if not node:
            continue

        if kind == "on_chain_start":
            seq += 1
            node_starts[node] = time.time()
            if not path or path[-1] != node:
                path.append(node)
            if is_postgres_configured():
                execute_void(
                    """
                    INSERT INTO langgraph_node_events (
                      run_id, node_id, event_type, status, input_payload, sequence_no, metadata
                    ) VALUES (%s, %s, 'start', 'running', %s::jsonb, %s, %s::jsonb)
                    """,
                    (
                        run_id,
                        node,
                        # Judge / counsel payloads are large — keep more of the node return.
                        json.dumps(
                            _sanitize(event.get("data", {}).get("input"), max_chars=60000),
                            default=str,
                        ),
                        seq,
                        json.dumps({"tags": tags}, default=str),
                    ),
                )
        elif kind == "on_chain_end":
            seq += 1
            started = node_starts.get(node)
            duration_ms = (time.time() - started) * 1000 if started else None
            if is_postgres_configured():
                execute_void(
                    """
                    INSERT INTO langgraph_node_events (
                      run_id, node_id, event_type, status, output_payload, duration_ms, sequence_no
                    ) VALUES (%s, %s, 'end', 'completed', %s::jsonb, %s, %s)
                    """,
                    (
                        run_id,
                        node,
                        json.dumps(
                            _sanitize(event.get("data", {}).get("output"), max_chars=60000),
                            default=str,
                        ),
                        duration_ms,
                        seq,
                    ),
                )
                if len(path) >= 2:
                    execute_void(
                        """
                        INSERT INTO langgraph_transitions (run_id, source_node, target_node, conditional)
                        VALUES (%s, %s, %s, true)
                        """,
                        (run_id, path[-2], path[-1]),
                    )
        elif kind == "on_chain_error":
            seq += 1
            err = str(event.get("data", {}).get("error") or "node error")
            if is_postgres_configured():
                execute_void(
                    """
                    INSERT INTO langgraph_node_events (
                      run_id, node_id, event_type, status, error, sequence_no
                    ) VALUES (%s, %s, 'error', 'failed', %s, %s)
                    """,
                    (run_id, node, err, seq),
                )

    try:
        snap = compiled.get_state(config)
        # Keep raw values for awaiting-input detection; sanitize only for storage.
        final_state = getattr(snap, "values", None) or snap
        final_config = getattr(snap, "config", None) or config
    except Exception:
        final_state = None

    return path, final_state, final_config


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _as_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


async def resume_and_run_test(
    run_id: str,
    message: str,
    answers: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """
    Continue a paused run on the same checkpoint thread.
    Sends a user message (and optional answer map) — works for question_processor
    and any future node that pauses with pending_* state keys.
    """
    run = execute_one("SELECT * FROM langgraph_runs WHERE id = %s", (run_id,))
    if not run:
        raise ValueError("Run not found")
    graph_id = run["graph_id"]
    meta = get_graph_metadata(graph_id)
    if meta.get("error"):
        raise RuntimeError(meta["error"])
    compiled = (
        get_clash_graph()
        if graph_id == "clash_agent"
        else _load_compiled(meta["module_path"], meta["graph_attr"])
    )

    from langchain_core.messages import HumanMessage

    text = (message or "").strip()
    cleaned_answers = {
        str(k): str(v) for k, v in (answers or {}).items() if str(v).strip()
    }

    # Clash Mode resumes via Command(resume=...) when efficiency V2 is on.
    if graph_id == "clash_agent":
        delegate = (
            cleaned_answers.pop("delegate", "").lower() in ("1", "true", "yes")
            or text in ("__delegate__", "[delegate]")
        )
        if not delegate and not text:
            for v in cleaned_answers.values():
                if str(v).strip():
                    text = str(v).strip()
                    break
        state = clash_resume_payload(answer=text, delegate=delegate)
    else:
        if not text and cleaned_answers:
            for v in cleaned_answers.values():
                if str(v).strip():
                    text = str(v).strip()
                    break
        if not text:
            raise ValueError("Provide a message or answer to resume the run")
        # Checkpoint holds prior state; with add_messages, this APPENDS the new human turn.
        state = {"messages": [HumanMessage(content=text)]}
        if cleaned_answers:
            prior = run.get("final_state") or {}
            if isinstance(prior, str):
                try:
                    prior = json.loads(prior)
                except Exception:
                    prior = {}
            prior_answers = {}
            if isinstance(prior, dict):
                prior_answers = prior.get("collected_answers") or {}
                if not isinstance(prior_answers, dict):
                    prior_answers = {}
            state["collected_answers"] = {**prior_answers, **cleaned_answers}

    if is_postgres_configured():
        execute_void(
            "UPDATE langgraph_runs SET status = 'running', error = NULL, finished_at = NULL WHERE id = %s",
            (run_id,),
        )

    prior_path = _as_list(run.get("path"))

    try:
        # Continue from the latest checkpoint on this thread (same as production chat).
        # Pinning checkpoint_id can time-travel to a stale pause point and re-ask Q1.
        thread_id = (
            (_run_checkpoint_config(run).get("configurable") or {}).get("thread_id")
            or _thread_id_for_run(str(run_id))
        )
        config = (
            clash_thread_config(thread_id)
            if graph_id == "clash_agent"
            else {"configurable": {"thread_id": thread_id}}
        )
        path, final_state, final_config = await _stream_and_record(
            compiled, state, config, str(run_id), path_seed=list(prior_path)
        )
        awaiting = extract_awaiting_input(final_state or {}, path)
        try:
            snap = compiled.get_state(config)
            awaiting = extract_awaiting_input(
                getattr(snap, "values", None) or final_state or {},
                path,
                graph_snapshot=snap,
            )
            from backend.agents.clash.pause import interrupt_payload_from_graph_state

            ip = interrupt_payload_from_graph_state(snap)
            if ip:
                base = final_state if isinstance(final_state, dict) else {}
                final_state = {**base, **ip, "awaiting_user_input": True}
        except Exception:
            pass
        status = "awaiting_input" if awaiting.get("awaiting") else "completed"
        if is_postgres_configured():
            execute_void(
                """
                UPDATE langgraph_runs
                SET status = %s, final_state = %s::jsonb, path = %s::jsonb,
                    checkpoint_config = %s::jsonb, finished_at = now()
                WHERE id = %s
                """,
                (
                    status,
                    json.dumps(_sanitize(final_state), default=str),
                    json.dumps(path),
                    json.dumps(_checkpoint_config(final_config), default=str),
                    run_id,
                ),
            )
    except Exception as exc:
        error = f"{exc}\n{traceback.format_exc()}"
        if is_postgres_configured():
            execute_void(
                """
                UPDATE langgraph_runs
                SET status = 'failed', error = %s, finished_at = now()
                WHERE id = %s
                """,
                (error, run_id),
            )
        raise

    return get_run(run_id)


def _thread_id_for_run(run_id: str) -> str:
    return f"admin-test-{run_id}"


def _checkpoint_config(config: Any) -> dict[str, Any]:
    """Keep only JSON-safe LangGraph checkpoint identity fields."""
    if not isinstance(config, dict):
        return {}
    configurable = config.get("configurable")
    if not isinstance(configurable, dict):
        return {}
    allowed = ("thread_id", "checkpoint_ns", "checkpoint_id")
    return {
        "configurable": {
            key: str(configurable[key])
            for key in allowed
            if configurable.get(key) is not None
        }
    }


def _run_checkpoint_config(run: dict[str, Any]) -> dict[str, Any]:
    raw = run.get("checkpoint_config")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = None
    if isinstance(raw, dict) and raw.get("configurable"):
        return raw
    return {"configurable": {"thread_id": _thread_id_for_run(str(run["id"]))}}


def _serialize_state(value: Any) -> Any:
    """Serialize checkpoint values without losing LangChain message structure."""
    from langchain_core.messages import BaseMessage, message_to_dict

    if isinstance(value, BaseMessage):
        return message_to_dict(value)
    if isinstance(value, dict):
        return {str(k): _serialize_state(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_state(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _deserialize_state(value: dict[str, Any]) -> dict[str, Any]:
    """Restore message dictionaries before feeding edited state to LangGraph."""
    from langchain_core.messages import messages_from_dict

    out = dict(value)
    raw_messages = out.get("messages")
    if raw_messages is not None:
        if not isinstance(raw_messages, list):
            raise ValueError("messages must be an array")
        try:
            out["messages"] = messages_from_dict(raw_messages)
        except Exception as exc:
            raise ValueError(
                "messages must use LangChain message objects: "
                '{"type":"human|ai|system","data":{"content":"..."}}'
            ) from exc
    return out


def _shape_errors(template: Any, candidate: Any, path: str = "$") -> list[str]:
    """Validate exact object keys and compatible JSON value types."""
    errors: list[str] = []
    if template is None:
        return errors
    if isinstance(template, bool):
        if not isinstance(candidate, bool):
            errors.append(f"{path} must be a boolean")
        return errors
    if isinstance(template, (int, float)) and not isinstance(template, bool):
        if not isinstance(candidate, (int, float)) or isinstance(candidate, bool):
            errors.append(f"{path} must be a number")
        return errors
    if isinstance(template, str):
        if not isinstance(candidate, str):
            errors.append(f"{path} must be a string")
        return errors
    if isinstance(template, list):
        if not isinstance(candidate, list):
            return [f"{path} must be an array"]
        if template:
            for index, item in enumerate(candidate):
                sample = template[index] if index < len(template) else template[-1]
                errors.extend(_shape_errors(sample, item, f"{path}[{index}]"))
        return errors
    if isinstance(template, dict):
        if not isinstance(candidate, dict):
            return [f"{path} must be an object"]
        missing = sorted(set(template) - set(candidate))
        extra = sorted(set(candidate) - set(template))
        if missing:
            errors.append(f"{path} is missing keys: {', '.join(missing)}")
        if extra:
            errors.append(f"{path} has unexpected keys: {', '.join(extra)}")
        for key in sorted(set(template) & set(candidate)):
            errors.extend(_shape_errors(template[key], candidate[key], f"{path}.{key}"))
        return errors
    return errors


def validate_node_payload(
    template: dict[str, Any],
    payload: dict[str, Any],
    topology: Optional[dict[str, Any]] = None,
) -> list[str]:
    if not isinstance(payload, dict):
        return ["Payload must be a JSON object"]
    errors = _shape_errors(template, payload)
    next_step = payload.get("next_step")
    if next_step is not None and topology:
        node_ids = {str(n.get("id")) for n in topology.get("nodes") or [] if n.get("id")}
        valid = node_ids | {"__end__", "END"}
        if str(next_step) not in valid:
            errors.append(f"$.next_step must be one of: {', '.join(sorted(valid))}")
    if "messages" in payload:
        try:
            _deserialize_state({"messages": payload["messages"]})
        except ValueError as exc:
            errors.append(str(exc))
    return errors


def _node_checkpoint(compiled, end_config: dict[str, Any], node_id: str):
    """Return the latest ancestor checkpoint immediately before node_id."""
    configurable = (end_config or {}).get("configurable") or {}
    thread_id = configurable.get("thread_id")
    history_config = {"configurable": {"thread_id": thread_id}}
    snapshots = list(compiled.get_state_history(history_config))
    by_id = {
        str((getattr(s, "config", {}) or {}).get("configurable", {}).get("checkpoint_id")): s
        for s in snapshots
    }
    checkpoint_id = configurable.get("checkpoint_id")
    current = by_id.get(str(checkpoint_id)) if checkpoint_id else (snapshots[0] if snapshots else None)
    visited: set[str] = set()
    while current is not None:
        if node_id in tuple(getattr(current, "next", ()) or ()):
            return current
        parent = getattr(current, "parent_config", None) or {}
        parent_id = (parent.get("configurable") or {}).get("checkpoint_id")
        if not parent_id or str(parent_id) in visited:
            break
        visited.add(str(parent_id))
        current = by_id.get(str(parent_id))
    raise ValueError(
        f"No replayable input checkpoint found for node '{node_id}'. "
        "Run the graph through this node first."
    )


def get_node_input_payload(run_id: str, node_id: str) -> dict[str, Any]:
    run = execute_one("SELECT * FROM langgraph_runs WHERE id = %s", (run_id,))
    if not run:
        raise ValueError("Run not found")
    if node_id in {"__start__", "__end__", "START", "END"}:
        raise ValueError("Start/END pseudo-nodes cannot be replayed")
    meta = get_graph_metadata(str(run["graph_id"]))
    topology = meta.get("topology") or {}
    node_ids = {str(n.get("id")) for n in topology.get("nodes") or [] if n.get("id")}
    if node_id not in node_ids:
        raise ValueError(f"Unknown node '{node_id}'")
    compiled = _load_compiled(meta["module_path"], meta["graph_attr"])
    end_config = _run_checkpoint_config(run)
    snapshot = _node_checkpoint(compiled, end_config, node_id)
    payload = _serialize_state(getattr(snapshot, "values", None) or {})
    return {
        "run_id": str(run_id),
        "node_id": node_id,
        "payload": payload,
        "checkpoint_config": _checkpoint_config(getattr(snapshot, "config", None)),
        "validation": {"ok": True, "errors": []},
    }


async def fork_run_from_node(
    run_id: str,
    node_id: str,
    payload: dict[str, Any],
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    """Fork a recorded run at the checkpoint immediately before node_id."""
    if not is_postgres_configured():
        raise RuntimeError("DATABASE_URL is required for persistent replay runs")
    run = execute_one("SELECT * FROM langgraph_runs WHERE id = %s", (run_id,))
    if not run:
        raise ValueError("Run not found")
    meta = get_graph_metadata(str(run["graph_id"]))
    if meta.get("error"):
        raise RuntimeError(meta["error"])
    topology = meta.get("topology") or {}
    node_ids = {str(n.get("id")) for n in topology.get("nodes") or [] if n.get("id")}
    if node_id in {"__start__", "__end__", "START", "END"} or node_id not in node_ids:
        raise ValueError(f"Node '{node_id}' cannot be replayed")

    compiled = _load_compiled(meta["module_path"], meta["graph_attr"])
    parent_end_config = _run_checkpoint_config(run)
    parent_snapshot = compiled.get_state(parent_end_config)
    pinned_parent_config = _checkpoint_config(
        getattr(parent_snapshot, "config", None) or parent_end_config
    )
    execute_void(
        """
        UPDATE langgraph_runs
        SET checkpoint_config = COALESCE(checkpoint_config, %s::jsonb)
        WHERE id = %s
        """,
        (json.dumps(pinned_parent_config), run_id),
    )

    source_snapshot = _node_checkpoint(compiled, pinned_parent_config, node_id)
    template = _serialize_state(getattr(source_snapshot, "values", None) or {})
    errors = validate_node_payload(template, payload, topology)
    if errors:
        raise ValueError("Invalid node payload: " + "; ".join(errors[:12]))

    runtime_payload = _deserialize_state(payload)
    if "messages" in runtime_payload:
        from langchain_core.messages import RemoveMessage
        from langgraph.graph.message import REMOVE_ALL_MESSAGES

        runtime_payload["messages"] = [
            RemoveMessage(id=REMOVE_ALL_MESSAGES),
            *runtime_payload["messages"],
        ]

    source_config = getattr(source_snapshot, "config", None)
    if not source_config:
        raise ValueError("The source checkpoint is no longer available")
    fork_config = compiled.update_state(source_config, runtime_payload)
    fork_snapshot = compiled.get_state(fork_config)
    if node_id not in tuple(getattr(fork_snapshot, "next", ()) or ()):
        raise RuntimeError(
            f"Checkpoint fork did not schedule '{node_id}'. "
            "The graph topology or routing fields in the payload are incompatible."
        )

    child_id = str(uuid.uuid4())
    query = str(run.get("query") or "")
    execute_void(
        """
        INSERT INTO langgraph_runs (
          id, graph_id, graph_version, status, query, initial_state,
          topology_snapshot, created_by, started_at, parent_run_id,
          fork_node_id, checkpoint_config
        ) VALUES (%s, %s, %s, 'running', %s, %s::jsonb, %s::jsonb, %s, now(), %s, %s, %s::jsonb)
        """,
        (
            child_id,
            run["graph_id"],
            run.get("graph_version") or meta.get("version") or _VERSION,
            query,
            json.dumps(payload, default=str),
            json.dumps(topology, default=str),
            created_by,
            run_id,
            node_id,
            json.dumps(_checkpoint_config(fork_config), default=str),
        ),
    )

    try:
        path, final_state, final_config = await _stream_and_record(
            compiled, None, fork_config, child_id, path_seed=[]
        )
        awaiting = extract_awaiting_input(final_state or {}, path)
        status = "awaiting_input" if awaiting.get("awaiting") else "completed"
        execute_void(
            """
            UPDATE langgraph_runs
            SET status = %s, final_state = %s::jsonb, path = %s::jsonb,
                checkpoint_config = %s::jsonb, finished_at = now()
            WHERE id = %s
            """,
            (
                status,
                json.dumps(_sanitize(final_state), default=str),
                json.dumps(path),
                json.dumps(_checkpoint_config(final_config), default=str),
                child_id,
            ),
        )
    except Exception as exc:
        error = f"{exc}\n{traceback.format_exc()}"
        execute_void(
            "UPDATE langgraph_runs SET status = 'failed', error = %s, finished_at = now() WHERE id = %s",
            (error, child_id),
        )
        raise
    return get_run(child_id)


def extract_awaiting_input(
    final_state: Any,
    path: Optional[list] = None,
    graph_snapshot: Any = None,
) -> dict[str, Any]:
    """
    Dynamically detect prompts that need user input from checkpoint/final state.

    Convention-based (not hard-wired to node names). Any current/future node can
    pause the graph by setting one of:
      - pending_questions + current_question_idx (+ question_collection_started)
      - awaiting_user_input + pending_question
      - langgraph interrupt() payload (Clash efficiency V2)
      - input_prompts: [{id, label, hint?, kind?}]
    """
    state = _as_dict(final_state)
    if state.get("_truncated"):
        return {
            "awaiting": False,
            "prompts": [],
            "collected_answers": {},
            "final_response": None,
            "truncated": True,
        }

    try:
        from backend.agents.clash.pause import interrupt_payload_from_graph_state

        ip = interrupt_payload_from_graph_state(graph_snapshot) or interrupt_payload_from_graph_state(
            final_state
        )
        if ip and ip.get("pending_question"):
            state = {**state, **ip, "awaiting_user_input": True}
    except Exception:
        pass

    prompts: list[dict[str, Any]] = []
    last_node = None
    if path:
        for n in reversed(path):
            if n and n not in {"LangGraph", "END", "__end__", "__start__"}:
                last_node = str(n)
                break

    situation = _as_dict(state.get("situation_summary"))
    collected = _as_dict(state.get("collected_answers"))
    # Q&A complete does not cancel later pause points (sexual_offense / moderator).
    if (
        situation.get("answers_collection_complete")
        and not state.get("waiting_for_sexual_offense_choice")
        and not state.get("waiting_for_moderator_resolution")
        and not state.get("awaiting_user_input")
        and not state.get("input_prompts")
        and not state.get("pending_question")
    ):
        return {
            "awaiting": False,
            "prompts": [],
            "collected_answers": collected,
            "final_response": state.get("final_response"),
        }

    # Explicit list of prompts (moderator resolve, sexual_offense choices, etc.)
    raw_prompts = state.get("input_prompts") or state.get("user_input_prompts")
    if isinstance(raw_prompts, list) and raw_prompts and state.get("awaiting_user_input") is not False:
        for i, item in enumerate(raw_prompts):
            if isinstance(item, dict):
                entry = {
                    "id": str(item.get("id") or item.get("key") or f"prompt_{i}"),
                    "label": str(
                        item.get("label") or item.get("question") or item.get("text") or f"Input {i + 1}"
                    ),
                    "hint": (str(item.get("hint") or item.get("context") or "") or None),
                    "node_id": str(item.get("node_id") or last_node or "user_input"),
                    "kind": str(item.get("kind") or "text"),
                }
                choices = item.get("choices")
                if isinstance(choices, list) and choices:
                    entry["choices"] = [
                        {
                            "id": str(c.get("id") or c.get("payload") or c.get("label") or idx),
                            "label": str(c.get("label") or c.get("id") or c),
                        }
                        if isinstance(c, dict)
                        else {"id": str(c), "label": str(c)}
                        for idx, c in enumerate(choices)
                    ]
                prompts.append(entry)
            elif item:
                prompts.append(
                    {
                        "id": f"prompt_{i}",
                        "label": str(item),
                        "node_id": last_node or "user_input",
                        "kind": "text",
                    }
                )

    # Fallback: sexual_offense suggested_actions → choice prompt
    if (
        not prompts
        and state.get("waiting_for_sexual_offense_choice")
        and isinstance(state.get("suggested_actions"), list)
        and state.get("suggested_actions")
    ):
        prompts.append(
            {
                "id": "sexual_offense_choice",
                "label": str(state.get("final_response") or "Choose a support option"),
                "hint": "Select an option to continue (or No to escalate to legal moderator).",
                "node_id": last_node or "sexual_offense",
                "kind": "choice",
                "choices": [
                    {
                        "id": str(a.get("payload") or a.get("label") or i),
                        "label": str(a.get("label") or a.get("payload") or f"Option {i + 1}"),
                    }
                    for i, a in enumerate(state.get("suggested_actions") or [])
                    if isinstance(a, dict)
                ],
            }
        )

    # Fallback: legal_moderator waiting for dashboard-style resolve
    if not prompts and state.get("waiting_for_moderator_resolution"):
        prompts.extend(
            [
                {
                    "id": "moderator_response",
                    "label": "Moderator response to the user",
                    "hint": "Same fields as /moderator dashboard resolution.",
                    "node_id": last_node or "legal_moderator",
                    "kind": "moderator_response",
                },
                {
                    "id": "moderator_options",
                    "label": "Suggested action options (comma-separated)",
                    "hint": "Optional labels, e.g. File FIR, Contact cyber cell",
                    "node_id": last_node or "legal_moderator",
                    "kind": "moderator_options",
                },
            ]
        )

    pending_questions = state.get("pending_questions") or []
    if isinstance(pending_questions, list) and pending_questions:
        idx = int(state.get("current_question_idx") or 0)
        started = bool(state.get("question_collection_started"))
        q_idx = idx if started else 0

        # All questions already answered (idx past end, or every key present)
        keys = []
        for i, q in enumerate(pending_questions):
            if isinstance(q, dict):
                keys.append(str(q.get("key") or q.get("question") or f"q_{i}"))
            else:
                keys.append(str(q))
        all_answered = bool(keys) and all(k in collected for k in keys)
        past_end = started and q_idx >= len(pending_questions)

        if not all_answered and not past_end and 0 <= q_idx < len(pending_questions):
            q = pending_questions[q_idx]
            # Prefer the current question text. Only use final_response when it
            # clearly refers to this question (avoids stale Q1 copy after resume).
            live = state.get("final_response")
            if isinstance(q, dict):
                q_text = str(q.get("question") or q.get("text") or f"Question {q_idx + 1}")
                if isinstance(live, str) and live.strip() and q_text in live:
                    label = live
                else:
                    label = q_text
                prompts.append(
                    {
                        "id": str(q.get("key") or f"q_{q_idx}"),
                        "label": label,
                        "hint": str(q.get("context") or "") or None,
                        "node_id": last_node or "question_processor",
                        "kind": "text",
                        "index": q_idx,
                        "total": len(pending_questions),
                    }
                )
            else:
                q_text = str(q)
                if isinstance(live, str) and live.strip() and q_text in live:
                    label = live
                else:
                    label = q_text
                prompts.append(
                    {
                        "id": f"q_{q_idx}",
                        "label": label,
                        "node_id": last_node or "question_processor",
                        "kind": "text",
                        "index": q_idx,
                        "total": len(pending_questions),
                    }
                )

    if state.get("awaiting_user_input") and state.get("pending_question"):
        user_action = str(state.get("user_action") or "answer")
        action_hint = {
            "argue": "Submit your courtroom argument for your side",
            "ask": "Type one cross-examination question for the opposing side",
            "answer": "Answer the cross-examination question with facts",
        }.get(user_action, "Reply to continue this turn")
        if state.get("ai_assist_allowed"):
            action_hint += " (or resume with answers.delegate=true to let AI counsel handle it)"
        prompts.append(
            {
                "id": "pending_question",
                "label": str(state.get("pending_question")),
                "hint": action_hint,
                "node_id": last_node or state.get("resume_node") or "cross_exam",
                "kind": "text",
                "user_action": user_action,
                "ai_assist_allowed": bool(state.get("ai_assist_allowed")),
                "question_target": state.get("question_target"),
                "mode": state.get("mode"),
                "user_role": state.get("user_role"),
            }
        )

    # Deduplicate by id
    seen: set[str] = set()
    uniq = []
    for p in prompts:
        if p["id"] in seen:
            continue
        seen.add(p["id"])
        uniq.append(p)

    return {
        "awaiting": bool(uniq),
        "prompts": uniq,
        "collected_answers": collected,
        "final_response": state.get("final_response"),
    }


def get_run(run_id: str) -> dict[str, Any]:
    run = execute_one("SELECT * FROM langgraph_runs WHERE id = %s", (run_id,))
    if not run:
        raise ValueError("Run not found")
    events = execute(
        "SELECT * FROM langgraph_node_events WHERE run_id = %s ORDER BY sequence_no ASC",
        (run_id,),
    )
    transitions = execute(
        "SELECT * FROM langgraph_transitions WHERE run_id = %s ORDER BY id ASC",
        (run_id,),
    )
    serialized = _serialize_row(run)
    path = _as_list(serialized.get("path"))
    serialized["path"] = path
    final_state = _as_dict(serialized.get("final_state"))
    serialized["final_state"] = final_state

    # Prefer live checkpoint state when available (avoids truncated JSON in DB).
    awaiting = extract_awaiting_input(final_state, path)
    try:
        meta = get_graph_metadata(str(serialized.get("graph_id")))
        if not meta.get("error"):
            compiled = (
                get_clash_graph()
                if serialized.get("graph_id") == "clash_agent"
                else _load_compiled(meta["module_path"], meta["graph_attr"])
            )
            run_config = _run_checkpoint_config(run)
            snap = compiled.get_state(run_config)
            live = getattr(snap, "values", None) or {}
            if isinstance(live, dict) and live:
                awaiting = extract_awaiting_input(live, path, graph_snapshot=snap)
                from backend.agents.clash.pause import interrupt_payload_from_graph_state

                ip = interrupt_payload_from_graph_state(snap)
                merged_live = {**live, **(ip or {})}
                if ip:
                    merged_live["awaiting_user_input"] = True
                serialized["final_state"] = _serialize_state(merged_live)
    except Exception:
        pass

    return {
        "run": serialized,
        "events": [_serialize_row(e) for e in events],
        "transitions": [_serialize_row(t) for t in transitions],
        "awaiting_input": awaiting,
        "thread_id": (
            (_run_checkpoint_config(run).get("configurable") or {}).get("thread_id")
            or _thread_id_for_run(str(run_id))
        ),
    }


def list_runs(graph_id: Optional[str] = None, limit: int = 50) -> list[dict[str, Any]]:
    if graph_id:
        rows = execute(
            "SELECT * FROM langgraph_runs WHERE graph_id = %s ORDER BY created_at DESC LIMIT %s",
            (graph_id, limit),
        )
    else:
        rows = execute("SELECT * FROM langgraph_runs ORDER BY created_at DESC LIMIT %s", (limit,))
    return [_serialize_row(r) for r in rows]


def list_presets(graph_id: Optional[str] = None) -> list[dict[str, Any]]:
    if graph_id:
        rows = execute(
            "SELECT * FROM langgraph_query_presets WHERE graph_id = %s ORDER BY created_at DESC",
            (graph_id,),
        )
    else:
        rows = execute("SELECT * FROM langgraph_query_presets ORDER BY created_at DESC")
    return [_serialize_row(r) for r in rows]


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in (row or {}).items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, uuid.UUID):
            out[k] = str(v)
        else:
            out[k] = v
    return out
