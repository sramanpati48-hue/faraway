"""OpenRouter LLM for Clash Mode agents (per-node model config)."""
from __future__ import annotations

from typing import Optional

from langchain_core.messages import BaseMessage

from backend.utils import get_llm_for_task


class ClashLLMWrapper:
    """Clash-specific LLM bound to a graph node task id."""

    def __init__(self, node_id: str = "prosecution"):
        self.node_id = node_id
        self._llm = get_llm_for_task(f"clash_agent.{node_id}")

    def invoke(
        self,
        messages: list[BaseMessage],
        *,
        max_tokens: int = 2000,
        temperature: float | None = None,
    ):
        return self._llm.invoke(messages, max_tokens=max_tokens, temperature=temperature)


_clash_llms: dict[str, ClashLLMWrapper] = {}


def get_clash_llm(node_id: str = "prosecution") -> ClashLLMWrapper:
    if node_id not in _clash_llms:
        _clash_llms[node_id] = ClashLLMWrapper(node_id)
    return _clash_llms[node_id]
