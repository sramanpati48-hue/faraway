"""Clash static context: prefer graph configurable, fall back to state."""
from __future__ import annotations

import hashlib
import os
from typing import Any, Optional

from backend.agents.clash.constants import JUDGE_PARAMETERS

# Feature flag — set CLASH_EFFICIENCY_V2=0 to restore END+incorporate pause path.
CLASH_EFFICIENCY_V2 = os.getenv("CLASH_EFFICIENCY_V2", "1").strip() not in (
    "0",
    "false",
    "False",
    "no",
)

STATIC_CONFIG_KEYS = (
    "case_title",
    "case_facts",
    "mock_case_id",
    "session_id",
    "judge_parameters",
    "mode",
    "user_role",
)


def _cfg(config: Any) -> dict[str, Any]:
    if not config:
        return {}
    if isinstance(config, dict):
        return dict(config.get("configurable") or {})
    return dict(getattr(config, "configurable", None) or {})


def get_config_dict(config: Any = None) -> dict[str, Any]:
    if config is not None:
        return _cfg(config)
    try:
        from langgraph.config import get_config

        return _cfg(get_config())
    except Exception:
        return {}


def case_title(state: dict, config: Any = None) -> str:
    cfg = get_config_dict(config)
    return str(cfg.get("case_title") or state.get("case_title") or "Matter")


def case_facts(state: dict, config: Any = None) -> str:
    cfg = get_config_dict(config)
    return str(cfg.get("case_facts") or state.get("case_facts") or "")


def mock_case_id(state: dict, config: Any = None) -> Optional[str]:
    cfg = get_config_dict(config)
    val = cfg.get("mock_case_id")
    if val is None:
        val = state.get("mock_case_id")
    return val


def session_id(state: dict, config: Any = None) -> str:
    cfg = get_config_dict(config)
    return str(cfg.get("session_id") or state.get("session_id") or "")


def judge_parameters(state: dict, config: Any = None) -> list:
    cfg = get_config_dict(config)
    params = cfg.get("judge_parameters") or state.get("judge_parameters") or JUDGE_PARAMETERS
    return list(params) if isinstance(params, list) else list(JUDGE_PARAMETERS)


def mode(state: dict, config: Any = None) -> str:
    cfg = get_config_dict(config)
    return str(cfg.get("mode") or state.get("mode") or "practice")


def user_role(state: dict, config: Any = None) -> str:
    cfg = get_config_dict(config)
    return str(cfg.get("user_role") or state.get("user_role") or "prosecution")


def fact_fingerprint(facts: str) -> str:
    return hashlib.sha256((facts or "").encode("utf-8")).hexdigest()[:16]


def statics_for_config(
    *,
    case_title: str,
    case_facts: str,
    mock_case_id: Any,
    session_id: str,
    mode: str,
    user_role: str,
    judge_parameters: Any = None,
) -> dict[str, Any]:
    return {
        "case_title": case_title,
        "case_facts": case_facts,
        "mock_case_id": mock_case_id,
        "session_id": session_id,
        "mode": mode,
        "user_role": user_role,
        "judge_parameters": judge_parameters or JUDGE_PARAMETERS,
        "fact_fingerprint": fact_fingerprint(case_facts),
    }


def has_phase_argument(state: dict, side: str, phase: str | None = None) -> bool:
    """True if transcript already has an argument for this side+phase."""
    phase = phase or state.get("phase") or "opening"
    out_key = "prosecution_output" if side == "prosecution" else "defence_output"
    if (state.get(out_key) or "").strip():
        # Output alone is not enough after judge clears it; require matching phase in transcript
        pass
    for e in state.get("transcript_entries") or []:
        if not isinstance(e, dict):
            continue
        if (
            e.get("side") == side
            and e.get("kind") == "argument"
            and e.get("phase") == phase
            and (e.get("content") or "").strip()
        ):
            return True
    return False
