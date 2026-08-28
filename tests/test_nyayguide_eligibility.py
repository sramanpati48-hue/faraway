"""NyayGuide eligibility gate tests (synthetic data only, no DB/network)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.nyayguide_eligibility import (  # noqa: E402
    CODE_EMERGENCY_ESCALATION_ACTIVE,
    CODE_HUMAN_REVIEW_REQUIRED,
    CODE_NYAYGUIDE_NOT_ELIGIBLE,
    CODE_VERIFICATION_INCOMPLETE,
    build_nyayguide_suggestion,
    evaluate_nyayguide_eligibility,
)


def _eligible_case(**overrides):
    report = {
        "incident_type": "Online UPI Fraud",
        "summary": "Synthetic test summary of an online payment fraud incident.",
        "risk_level": "low",
        "risk_flags": [],
        "ai_verification_status": "verified",
        "nyayguide_support_needed": True,
    }
    row = {"id": "case-1", "user_id": "user-1", "structured_report": report}
    row.update(overrides)
    return row


def test_eligible_verified_request_is_allowed():
    result = evaluate_nyayguide_eligibility(_eligible_case())
    assert result["allowed"] is True
    assert result["code"] is None

    suggestion = build_nyayguide_suggestion(
        _eligible_case()["structured_report"], support_needs_met=True, case_id="case-1"
    )
    assert suggestion is not None
    assert suggestion["enabled"] is True
    assert suggestion["kind"] == "nyayguide_suggestion"
    assert suggestion["requires_user_confirmation"] is True


def test_legacy_verified_status_without_explicit_support_marker_is_allowed():
    report = {
        "summary": "Synthetic summary",
        "risk_level": "Low",
        "ai_verification_status": "verified",
    }
    result = evaluate_nyayguide_eligibility({"structured_report": report})
    assert result["allowed"] is True


def test_active_human_review_blocks_with_409_code():
    row = _eligible_case()
    row["structured_report"]["ai_verification_status"] = "flagged"
    result = evaluate_nyayguide_eligibility(row)
    assert result["allowed"] is False
    assert result["code"] == CODE_HUMAN_REVIEW_REQUIRED

    assert build_nyayguide_suggestion(row["structured_report"]) is None


def test_emergency_escalation_blocks_even_if_verified():
    row = _eligible_case()
    row["structured_report"]["workflow_state"] = "EMERGENCY_ESCALATION"
    result = evaluate_nyayguide_eligibility(row)
    assert result["allowed"] is False
    assert result["code"] == CODE_EMERGENCY_ESCALATION_ACTIVE
    assert evaluate_nyayguide_eligibility(row)["code"] == CODE_EMERGENCY_ESCALATION_ACTIVE


def test_incomplete_verification_returns_verification_incomplete():
    for status in ("pending", "", None):
        row = _eligible_case()
        row["structured_report"]["ai_verification_status"] = status
        if status is None:
            row.pop("ai_verification_status", None)
            row["structured_report"].pop("ai_verification_status")
        result = evaluate_nyayguide_eligibility(row)
        assert result["allowed"] is False
        assert result["code"] == CODE_VERIFICATION_INCOMPLETE


def test_no_server_approved_support_need_returns_not_eligible():
    row = _eligible_case()
    row["structured_report"]["nyayguide_support_needed"] = False
    row["ai_verification_status"] = "verified_for_next_step"
    row["structured_report"].pop("summary")
    result = evaluate_nyayguide_eligibility(row)
    assert result["allowed"] is False
    assert result["code"] == CODE_NYAYGUIDE_NOT_ELIGIBLE


def test_client_provided_verification_fields_are_not_trusted():
    report = {
        "summary": "x" * 30,
        "client_says": "verified",
        "verification_status": "VERIFIED_FOR_NEXT_STEP",
        "nyayguide_eligible": True,
        "eligibility": "approved",
    }
    result = evaluate_nyayguide_eligibility({"structured_report": report})
    assert result["allowed"] is False
    assert result["code"] == CODE_VERIFICATION_INCOMPLETE


def test_moderator_resolution_clears_review_block_but_not_emergency():
    resolved = {
        "structured_report": {
            "ai_verification_status": "flagged",
            "workflow_state": "MODERATOR_APPROVED",
            "nyayguide_support_needed": True,
            "summary": "s",
        }
    }
    assert evaluate_nyayguide_eligibility(resolved)["allowed"] is True

    emergency = {
        "structured_report": {
            **resolved["structured_report"],
            "emergency_escalation_active": True,
        }
    }
    assert (
        evaluate_nyayguide_eligibility(emergency)["code"]
        == CODE_EMERGENCY_ESCALATION_ACTIVE
    )


# ---------------------------------------------------------------------------
# Workflow-state registry regression: adding/renaming a state must fail CI
# until the gate (and frontend allowlist contract) is explicitly reviewed.
# ---------------------------------------------------------------------------


def _module_workflow_states():
    import backend.services.nyayguide_eligibility as eligibility

    return {
        value
        for name, value in vars(eligibility).items()
        if name.startswith("WORKFLOW_") and isinstance(value, str)
    }


def test_workflow_states_are_registered():
    from backend.services import nyayguide_eligibility as eligibility

    assert _module_workflow_states() == eligibility.KNOWN_WORKFLOW_STATES


def test_only_reviewed_states_permit_creation():
    from backend.services.nyayguide_eligibility import KNOWN_WORKFLOW_STATES, WORKFLOW_ELIGIBLE, WORKFLOW_MODERATOR_APPROVED

    permitting = set()
    for state in sorted(KNOWN_WORKFLOW_STATES):
        row = _eligible_case()
        row["structured_report"]["workflow_state"] = state
        if evaluate_nyayguide_eligibility(row)["allowed"]:
            permitting.add(state)

    assert permitting == {WORKFLOW_ELIGIBLE, WORKFLOW_MODERATOR_APPROVED}, (
        f"Unexpected workflow states now permit NyayGuide creation: "
        f"{permitting - {WORKFLOW_ELIGIBLE, WORKFLOW_MODERATOR_APPROVED}}. "
        f"Review them, update this allowlist, and mirror the change in "
        f"web_app/components/chat/CaseSuggestionsRail.tsx."
    )


# ---------------------------------------------------------------------------
# Route-level tests: gate runs before any request row / dispatch is created.
# ---------------------------------------------------------------------------


class _FakeTransactional:
    def __init__(self):
        self.calls = []
        self.existing_by_key = {}

    def __call__(self, **kwargs):
        key = kwargs.get("idempotency_key")
        if key and key in self.existing_by_key:
            return self.existing_by_key[key]
        self.calls.append(kwargs)
        req = {"id": f"req-{len(self.calls)}", "status": "SEARCHING", **{
            k: v for k, v in kwargs.items() if k in {"case_id", "user_id"}
        }}
        if key:
            self.existing_by_key[key] = req
        return req


@pytest.fixture()
def route_env(monkeypatch):
    from backend.routes import nyayguide_routes as routes

    fake = _FakeTransactional()
    monkeypatch.setattr(routes, "get_case_complete", lambda case_id: _eligible_case(id=case_id))
    monkeypatch.setattr(
        routes, "create_nyayguide_request_transactional", lambda **kw: fake(**kw)
    )
    return routes, fake


def _request_body(routes, case_id="case-1", idem=None):
    return routes.CreateNyayGuideRequestBody(
        case_id=case_id,
        assistance_type="document_support",
        confirmed=True,
        location_consent=False,
        idempotency_key=idem,
    )


def _create(routes, case_id="case-1", idem=None):
    body = _request_body(routes, case_id=case_id, idem=idem)
    return asyncio.run(
        routes.create_nyayguide_request(body=body, user={"id": "user-1"})
    )


def test_route_creates_request_for_eligible_case(route_env):
    routes, fake = route_env
    payload = _create(routes)
    assert payload["request"]["id"] == "req-1"
    assert len(fake.calls) == 1


def test_route_reuses_request_on_same_idempotency_key(route_env):
    routes, fake = route_env
    first = _create(routes, idem="ng_req_test_1")
    second = _create(routes, idem="ng_req_test_1")
    assert first["request"]["id"] == second["request"]["id"]
    assert len(fake.calls) == 1


def _assert_blocked(route_env, mutate, expected_code):
    routes, fake = route_env
    original = routes.get_case_complete

    def patched(case_id):
        row = original(case_id)
        mutate(row["structured_report"])
        return row

    routes.get_case_complete = patched
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        _create(routes)
    assert exc_info.value.status_code == 409
    detail = exc_info.value.detail
    assert detail["code"] == expected_code
    assert fake.calls == []


def test_route_blocks_human_review_and_persists_nothing(route_env):
    _assert_blocked(
        route_env,
        lambda r: r.update(ai_verification_status="flagged"),
        CODE_HUMAN_REVIEW_REQUIRED,
    )


def test_route_blocks_emergency_and_persists_nothing(route_env):
    _assert_blocked(
        route_env,
        lambda r: r.update(workflow_state="EMERGENCY_ESCALATION"),
        CODE_EMERGENCY_ESCALATION_ACTIVE,
    )


def test_route_blocks_incomplete_verification_and_persists_nothing(route_env):
    _assert_blocked(
        route_env,
        lambda r: r.update(ai_verification_status="pending"),
        CODE_VERIFICATION_INCOMPLETE,
    )


def test_route_blocks_unapproved_support_and_persists_nothing(route_env):
    def mutate(r):
        r["nyayguide_support_needed"] = False
        r.pop("summary")

    _assert_blocked(route_env, mutate, CODE_NYAYGUIDE_NOT_ELIGIBLE)


# ---------------------------------------------------------------------------
# Idempotency across moderator transition + concurrency + audit trail.
# ---------------------------------------------------------------------------


class _LockedTransactional:
    """Emulates SELECT ... FOR UPDATE serialization of the real service."""

    def __init__(self):
        import threading

        self._lock = threading.Lock()
        self.rows = []

    def __call__(self, **kwargs):
        with self._lock:
            key = kwargs.get("idempotency_key")
            for row in self.rows:
                if key and row.get("idempotency_key") == key:
                    return row
                if row["case_id"] == kwargs["case_id"] and row["user_id"] == kwargs["user_id"]:
                    return row
            row = {
                "id": f"req-{len(self.rows) + 1}",
                "status": "SEARCHING",
                "idempotency_key": key,
                "case_id": kwargs["case_id"],
                "user_id": kwargs["user_id"],
            }
            self.rows.append(row)
            return row


@pytest.fixture()
def live_route_env(monkeypatch):
    from backend.routes import nyayguide_routes as routes

    fake = _LockedTransactional()
    monkeypatch.setattr(routes, "get_case_complete", lambda case_id: _eligible_case(id=case_id))
    monkeypatch.setattr(routes, "create_nyayguide_request_transactional", lambda **kw: fake(**kw))
    return routes, fake


def test_retry_after_moderator_clears_review_succeeds_exactly_once(monkeypatch):
    from backend.routes import nyayguide_routes as routes

    fake = _LockedTransactional()
    monkeypatch.setattr(routes, "create_nyayguide_request_transactional", lambda **kw: fake(**kw))

    def case_with(status=None, workflow=None):
        def loader(case_id):
            row = _eligible_case(id=case_id)
            if status:
                row["structured_report"]["ai_verification_status"] = status
            if workflow:
                row["structured_report"]["workflow_state"] = workflow
            return row

        return loader

    # 1. Blocked while flagged: nothing persisted.
    monkeypatch.setattr(routes, "get_case_complete", case_with(status="flagged"))
    with pytest.raises(Exception):
        _create(routes, idem="ng_req_review_1")
    assert fake.rows == []

    # 2. Moderator clears review -> retry succeeds exactly once.
    monkeypatch.setattr(
        routes,
        "get_case_complete",
        case_with(workflow="MODERATOR_APPROVED"),
    )
    first = _create(routes, idem="ng_req_review_1")
    second = _create(routes, idem="ng_req_review_1")
    assert len(fake.rows) == 1
    assert first["request"]["id"] == second["request"]["id"] == "req-1"


def test_concurrent_creates_during_transition_produce_single_request(live_route_env):
    import asyncio

    routes, fake = live_route_env

    async def race():
        return await asyncio.gather(
            routes.create_nyayguide_request(
                body=_request_body(routes, idem="ng_req_race_a"), user={"id": "user-1"}
            ),
            routes.create_nyayguide_request(
                body=_request_body(routes, idem="ng_req_race_b"), user={"id": "user-1"}
            ),
        )

    results = asyncio.run(race())
    request_ids = {r["request"]["id"] for r in results}
    assert len(request_ids) == 1
    assert len(fake.rows) == 1


def test_blocked_attempt_writes_audit_entry_with_case_and_reason(route_env, monkeypatch):
    import pytest as _pytest
    from fastapi import HTTPException

    routes, fake = route_env
    captured = []
    monkeypatch.setattr(
        routes,
        "execute_void",
        lambda sql, params: captured.append((sql, params)),
    )

    original = routes.get_case_complete

    def flagged_loader(case_id):
        row = original(case_id)
        row["structured_report"]["ai_verification_status"] = "flagged"
        return row

    routes.get_case_complete = flagged_loader
    with _pytest.raises(HTTPException) as exc_info:
        _create(routes)
    assert exc_info.value.status_code == 409

    assert len(captured) == 1
    sql, params = captured[0]
    assert "auth_audit_events" in sql
    user_id, event_type, detail_json = params
    assert user_id == "user-1"
    assert event_type == "nyayguide_request_blocked"
    assert '"reason_code"' in detail_json
    assert CODE_HUMAN_REVIEW_REQUIRED in detail_json
    assert '"case_id"' in detail_json
    assert fake.calls == []


def test_audit_failure_does_not_block_the_409(route_env, monkeypatch, caplog):
    import pytest as _pytest
    from fastapi import HTTPException

    routes, _fake = route_env

    def boom(sql, params):
        raise RuntimeError("audit sink down")

    monkeypatch.setattr(routes, "execute_void", boom)
    original = routes.get_case_complete

    def emergency_loader(case_id):
        row = original(case_id)
        row["structured_report"]["workflow_state"] = "EMERGENCY_ESCALATION"
        return row

    routes.get_case_complete = emergency_loader
    with _pytest.raises(HTTPException) as exc_info:
        _create(routes)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == CODE_EMERGENCY_ESCALATION_ACTIVE

    assert any(
        "nyayguide audit write failed" in rec.message
        for rec in caplog.records
        if rec.levelname == "ERROR"
    )
