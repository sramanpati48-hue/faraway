"""Schema-preserving AI generation for admin LangGraph replay payloads."""
from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from backend.services import admin_models
from backend.services.graph_registry import get_graph_metadata, validate_node_payload
from backend.utils import invoke_llm_with_selection


def _models_for_provider(provider: str) -> tuple[str, ...]:
    return admin_models.models_for_provider(provider)


def _response_text(response: Any) -> str:
    content = getattr(response, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(block.get("text") or "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content or "")


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("The model did not return a JSON object")
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError(f"The model returned invalid JSON: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("The model response must be a JSON object")
    return parsed


def generate_node_payload(
    *,
    graph_id: str,
    node_id: str,
    prompt: str,
    base_payload: dict[str, Any],
    provider: str,
    model: str,
) -> dict[str, Any]:
    prompt = (prompt or "").strip()
    provider = (provider or "").strip().lower()
    model = (model or "").strip()
    if not prompt:
        raise ValueError("Describe the payload you want the AI to generate")
    if not isinstance(base_payload, dict) or not base_payload:
        raise ValueError("A non-empty base payload is required")
    allowed_models = _models_for_provider(provider)
    if not allowed_models:
        raise ValueError(f"Unsupported provider '{provider}'")
    if model not in allowed_models:
        raise ValueError(f"Model '{model}' is not available for {provider}")

    meta = get_graph_metadata(graph_id)
    topology = meta.get("topology") or {}
    node_ids = {str(n.get("id")) for n in topology.get("nodes") or [] if n.get("id")}
    if node_id not in node_ids:
        raise ValueError(f"Unknown node '{node_id}'")

    template_json = json.dumps(base_payload, ensure_ascii=False, indent=2)
    system = SystemMessage(
        content=(
            "You generate complete LangGraph node input payloads for an admin test tool. "
            "Return one JSON object only: no markdown, commentary, or omitted fields. "
            "The output must have exactly the same object keys and compatible JSON value "
            "types as the template. Preserve LangChain messages as objects with type and "
            "data fields. Change values to satisfy the request while keeping the payload "
            "internally consistent. Do not invent credentials, tokens, or secrets."
        )
    )
    request = HumanMessage(
        content=(
            f"Graph: {graph_id}\nNode to execute: {node_id}\n"
            f"Requested scenario:\n{prompt}\n\nExact payload template:\n{template_json}"
        )
    )
    task_id = f"admin.payload_generator.{graph_id}.{node_id}"
    response = invoke_llm_with_selection(
        provider,
        model,
        [system, request],
        task_id=task_id,
        temperature=0,
        max_tokens=8192,
    )
    payload = _extract_json_object(_response_text(response))
    errors = validate_node_payload(base_payload, payload, topology)

    if errors:
        repair = HumanMessage(
            content=(
                "Repair your JSON and return the complete object only. Validation errors:\n- "
                + "\n- ".join(errors[:20])
                + "\n\nYour invalid object:\n"
                + json.dumps(payload, ensure_ascii=False, indent=2)
            )
        )
        response = invoke_llm_with_selection(
            provider,
            model,
            [system, request, repair],
            task_id=task_id,
            temperature=0,
            max_tokens=8192,
        )
        payload = _extract_json_object(_response_text(response))
        errors = validate_node_payload(base_payload, payload, topology)

    if errors:
        raise ValueError("Generated payload failed validation: " + "; ".join(errors[:12]))
    return {
        "payload": payload,
        "validation": {"ok": True, "errors": []},
        "model_used": {"provider": provider, "model": model},
    }
