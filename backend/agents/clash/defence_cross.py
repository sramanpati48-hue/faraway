"""Backwards-compatible re-export — use ai_cross_answer_node for both sides."""
from backend.agents.clash.ai_cross_answer import (
    ai_cross_answer_node,
    defence_cross_answer_node,
)

__all__ = ["ai_cross_answer_node", "defence_cross_answer_node"]
