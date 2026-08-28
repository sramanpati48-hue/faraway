"""Moderator-resolution state synchronization tests (no real DB).

Verifies that resolving an intervention persists the canonical workflow
outcome onto the case row, keeps emergency non-overridable, and rebuilds
server-authoritative NyayGuide suggestions.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.database import postgres_db  # noqa: E402


def _report(**overrides):
    report = {
        "incident_type": "Criminal Assault",
        "summary": "Synthetic flagged assault case summary.",
        "risk_level": "high",
        "ai_verification_status": "flagged",
        "workflow_state": "HIGH_RISK_HUMAN_REVIEW",
    }
    report.update(overrides)
    return report


@pytest.fixture()
def db_env(monkeypatch):
    state = {"reports": {"case-1": _report()}, "updates": []}

    def fake_execute_one(sql, params=None):
        case_id = (params or ("",))[0]
        if "FROM cases" in sql:
            if case_id not in state["reports"]:
                return None
            return {
                "structured_report": state["reports"][case_id],
                "ai_verification_status": state["reports"][case_id].get(
                    "ai_verification_status"
                ),
            }
        return None

    def fake_execute_void(sql, params=None):
        state["updates"].append((sql, params))
        if "UPDATE cases" in sql:
            case_id = params[2]
            import json as _json

            state["reports"][case_id] = _json.loads(params[0])

    monkeypatch.setattr(postgres_db, "execute_one", fake_execute_one)
    monkeypatch.setattr(postgres_db, "execute_void", fake_execute_void)
    return state


def _apply(state, **kwargs):
    return postgres_db._apply_moderator_review_outcome("case-1", **kwargs)


def test_digital_guidance_persists_approved_without_support(db_env):
    snapshot = _apply(db_env, review_outcome="digital_guidance")

    assert snapshot["workflow_state"] == "MODERATOR_APPROVED"
    assert snapshot["nyayguide_support_needed"] is False
    assert snapshot["suggested_actions"] == []
    assert snapshot["ai_verification_status"] == "verified_for_next_step"

    persisted = db_env["reports"]["case-1"]
    assert persisted["workflow_state"] == "MODERATOR_APPROVED"
    assert persisted["nyayguide_support_needed"] is False
    assert len(db_env["updates"]) == 1


def test_nyayguide_recommended_enables_typed_suggestion(db_env):
    snapshot = _apply(
        db_env,
        review_outcome="nyayguide_recommended",
        assistance_type="complaint_filing_support",
    )

    assert snapshot["workflow_state"] == "MODERATOR_APPROVED"
    assert snapshot["nyayguide_support_needed"] is True
    actions = snapshot["suggested_actions"]
    assert len(actions) == 1
    action = actions[0]
    assert action["kind"] == "nyayguide_suggestion"
    assert action["enabled"] is True
    assert action["requires_user_confirmation"] is True
    # Evaluator reports its resulting permitting state; frontend accepts both.
    assert action["workflow_state"] in {"ELIGIBLE", "MODERATOR_APPROVED"}

    persisted = db_env["reports"]["case-1"]
    assert persisted["nyayguide_assistance_type"] == "complaint_filing_support"


def test_active_emergency_is_never_downgraded_to_approved(db_env):
    db_env["reports"]["case-1"] = _report(
        workflow_state="EMERGENCY_ESCALATION",
        emergency_escalation_active=True,
    )

    snapshot = _apply(
        db_env,
        review_outcome="approved_for_next_step",
        support_needed=True,
    )

    assert snapshot["workflow_state"] == "EMERGENCY_ESCALATION"
    assert snapshot["suggested_actions"] == []
    # No canonical write may downgrade the emergency state.
    assert db_env["updates"] == []
    assert (
        db_env["reports"]["case-1"]["workflow_state"] == "EMERGENCY_ESCALATION"
    )


def test_unable_to_verify_fails_closed(db_env):
    snapshot = _apply(db_env, review_outcome="unable_to_verify")

    assert snapshot["workflow_state"] == "UNABLE_TO_VERIFY"
    assert snapshot["suggested_actions"] == []
    persisted = db_env["reports"]["case-1"]
    assert persisted["workflow_state"] == "UNABLE_TO_VERIFY"
    assert persisted["ai_verification_status"] == "rejected"


def test_unknown_case_returns_none_without_write(db_env):
    result = postgres_db._apply_moderator_review_outcome(
        "missing-case", review_outcome="approved_for_next_step"
    )
    assert result is None
    assert db_env["updates"] == []


# ---------------------------------------------------------------------------
# Wiring through resolve_intervention_case: snapshot rides on the result dict.
# ---------------------------------------------------------------------------


def test_snapshot_included_in_resolve_result(db_env, monkeypatch):
    applied = {}

    def fake_apply(case_id, **kwargs):
        applied["args"] = kwargs
        return {
            "workflow_state": "MODERATOR_APPROVED",
            "structured_report": db_env["reports"]["case-1"],
            "ai_verification_status": "verified_for_next_step",
            "nyayguide_support_needed": False,
            "suggested_actions": [],
            "version": "2026-01-01T00:00:00+00:00",
        }

    def fake_execute(sql, params=None):
        if "UPDATE interventions" in sql:
            return [
                {
                    "id": "case-1",
                    "user_id": "user-1",
                    "session_id": "session-1",
                    "assigned_moderator_id": None,
                }
            ]
        return []

    def fake_execute_one(sql, params=None):
        if "session_data" in sql:
            return {"session_data": []}
        if "moderator_case_revisions" in sql:
            return None
        if "FROM cases" in sql and "structured_report" in sql:
            return {
                "structured_report": db_env["reports"]["case-1"],
                "ai_verification_status": "flagged",
            }
        return None

    noop = lambda *a, **kw: None
    monkeypatch.setattr(postgres_db, "execute", fake_execute)
    monkeypatch.setattr(postgres_db, "execute_one", fake_execute_one)
    monkeypatch.setattr(postgres_db, "execute_void", lambda sql, params=None: None)
    monkeypatch.setattr(postgres_db, "set_case_pending_status", noop)
    monkeypatch.setattr(postgres_db, "update_moderator_case_revision_on_resolve", lambda **kw: None)
    monkeypatch.setattr(postgres_db, "complete_moderator_updatation", lambda **kw: None)
    monkeypatch.setattr(postgres_db, "_apply_moderator_review_outcome", fake_apply)

    result = postgres_db.resolve_intervention_case(
        "case-1",
        "Approved.",
        [],
        review_outcome="digital_guidance",
        nyayguide_support_needed=False,
    )

    assert result["success"] is True
    assert result["case_snapshot"]["workflow_state"] == "MODERATOR_APPROVED"
    assert result["case_snapshot"]["version"]
    assert applied["args"]["review_outcome"] == "digital_guidance"
    assert applied["args"]["support_needed"] is False
