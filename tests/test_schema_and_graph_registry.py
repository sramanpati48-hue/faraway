"""Schema + dynamic graph registry smoke tests (require DATABASE_URL for DB checks)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_graph_introspection_chat_and_clash():
    import pytest
    from backend.services.graph_registry import introspect_topology, list_registered_graphs

    graphs = list_registered_graphs(refresh=False)
    assert any(g.get("graph_id") == "chat_agent" for g in graphs)
    assert any(g.get("graph_id") == "clash_agent" for g in graphs)

    try:
        from backend.agent_graph import agent_graph
    except Exception as exc:
        pytest.skip(f"agent_graph unavailable in this environment: {exc}")

    topo = introspect_topology(agent_graph)
    node_ids = {n["id"] for n in topo["nodes"]}
    assert "supervisor" in node_ids
    assert "report_generator" in node_ids
    assert topo["edge_count"] > 0


def test_new_node_would_appear_without_frontend_constants():
    """Registry derives nodes from compiled graph, not hardcoded UI lists."""
    import pytest
    from backend.services.graph_registry import user_facing_stream_nodes

    try:
        nodes = user_facing_stream_nodes("chat_agent")
    except Exception as exc:
        pytest.skip(f"graph unavailable: {exc}")
    if not nodes:
        pytest.skip("compiled chat graph could not be loaded in this environment")
    assert "cyber" in nodes or "civil" in nodes
    assert "supervisor" not in nodes
    assert "report_generator" not in nodes


def test_expected_tables_when_database_configured():
    if not os.getenv("DATABASE_URL"):
        return
    from backend.database.postgres_pool import close_pool, execute

    rows = execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """
    )
    names = {r["table_name"] for r in rows}
    for required in (
        "users",
        "cases",
        "chat_history",
        "interventions",
        "legal_documents",
        "langgraph_runs",
        "langgraph_node_events",
    ):
        assert required in names, f"missing {required}"
    close_pool()


def test_replay_payload_message_round_trip_and_shape_validation():
    from langchain_core.messages import AIMessage, HumanMessage
    from backend.services.graph_registry import (
        _deserialize_state,
        _serialize_state,
        validate_node_payload,
    )

    original = {
        "messages": [HumanMessage(content="hello"), AIMessage(content="How can I help?")],
        "next_step": "civil",
        "context": {"authenticated": False},
    }
    serialized = _serialize_state(original)
    restored = _deserialize_state(serialized)
    assert [m.content for m in restored["messages"]] == ["hello", "How can I help?"]

    topology = {"nodes": [{"id": "civil"}, {"id": "cyber"}]}
    assert validate_node_payload(serialized, serialized, topology) == []
    invalid = {**serialized, "next_step": "not_a_node"}
    assert any("next_step" in error for error in validate_node_payload(serialized, invalid, topology))
    missing = dict(serialized)
    missing.pop("context")
    assert any("missing keys" in error for error in validate_node_payload(serialized, missing, topology))


def test_checkpoint_fork_replays_selected_node_without_mutating_parent():
    from typing import TypedDict
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import END, START, StateGraph
    from backend.services.graph_registry import _node_checkpoint

    class State(TypedDict):
        value: str

    calls: list[str] = []

    def first(state: State):
        calls.append("first")
        return {"value": state["value"] + "-first"}

    def second(state: State):
        calls.append("second")
        return {"value": state["value"] + "-second"}

    builder = StateGraph(State)
    builder.add_node("first", first)
    builder.add_node("second", second)
    builder.add_edge(START, "first")
    builder.add_edge("first", "second")
    builder.add_edge("second", END)
    graph = builder.compile(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "replay-test"}}
    graph.invoke({"value": "base"}, config)

    parent_snapshot = graph.get_state(config)
    parent_config = parent_snapshot.config
    before_second = _node_checkpoint(graph, parent_config, "second")
    fork_config = graph.update_state(before_second.config, {"value": "edited"})
    calls.clear()
    fork_result = graph.invoke(None, fork_config)

    assert calls == ["second"]
    assert fork_result["value"] == "edited-second"
    assert graph.get_state(parent_config).values["value"] == "base-first-second"


def test_payload_generator_parses_and_validates_selected_model(monkeypatch):
    from types import SimpleNamespace
    from backend.services import graph_payload_generator as generator

    template = {"messages": [], "next_step": "civil", "user_id": ""}
    generated = {"messages": [], "next_step": "cyber", "user_id": "admin-test"}
    monkeypatch.setattr(
        generator,
        "get_graph_metadata",
        lambda graph_id: {
            "topology": {"nodes": [{"id": "civil"}, {"id": "cyber"}, {"id": "supervisor"}]}
        },
    )
    monkeypatch.setattr(
        generator,
        "invoke_llm_with_selection",
        lambda *args, **kwargs: SimpleNamespace(content=f"```json\n{__import__('json').dumps(generated)}\n```"),
    )
    result = generator.generate_node_payload(
        graph_id="chat_agent",
        node_id="supervisor",
        prompt="Route an authenticated cyber fraud scenario",
        base_payload=template,
        provider="groq",
        model="llama-3.3-70b-versatile",
    )
    assert result["payload"] == generated
    assert result["model_used"]["provider"] == "groq"
