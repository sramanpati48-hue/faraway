"""Role / mode helpers for Clash Mode courtroom simulation."""
from __future__ import annotations

from typing import Literal, Optional

UserRole = Literal["prosecution", "defence"]
UserAction = Literal["argue", "ask", "answer"]


def normalize_user_role(role: Optional[str]) -> UserRole:
    r = (role or "prosecution").strip().lower()
    if r in ("defence", "defense", "defendant", "accused"):
        return "defence"
    return "prosecution"


def opposing_side(side: str) -> UserRole:
    return "defence" if side == "prosecution" else "prosecution"


def is_user_side(state: dict, side: str) -> bool:
    return normalize_user_role(state.get("user_role")) == side


def is_practice(state: dict) -> bool:
    return (state.get("mode") or "practice") == "practice"


def is_real_life(state: dict) -> bool:
    return (state.get("mode") or "practice") == "real_life"


def should_user_argue(state: dict, side: str) -> bool:
    """Practice: user drives their own side's argument (unless force_ai / delegate)."""
    if state.get("force_ai"):
        return False
    return is_practice(state) and is_user_side(state, side)


def should_user_ask(state: dict, asker_side: str) -> bool:
    """Practice: user types their own cross-exam question."""
    if state.get("force_ai"):
        return False
    return is_practice(state) and is_user_side(state, asker_side)


def should_user_answer(state: dict, target_side: str) -> bool:
    """Pause when the question is directed at the user's party (both modes).

    Practice also allows AI-assist (delegate). Real-life always needs the user
    for factual answers about their side.
    """
    if state.get("force_ai") and is_practice(state):
        return False
    return is_user_side(state, target_side)


def ai_assist_allowed(state: dict) -> bool:
    """AI-assist ('let my counsel handle this') is practice-only."""
    return is_practice(state)


def party_label(side: str) -> str:
    return "Prosecution (Complainant)" if side == "prosecution" else "Defence (Accused)"
