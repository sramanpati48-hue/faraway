"""Server-authoritative NyayGuide eligibility evaluation.

Pure module (no DB/network imports) so it is unit-testable in isolation.
All inputs come from server-persisted case rows; client-provided
verification/eligibility fields are never trusted.
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

VERIFIED_FOR_NEXT_STEP = "verified_for_next_step"

WORKFLOW_HIGH_RISK_HUMAN_REVIEW = "HIGH_RISK_HUMAN_REVIEW"
WORKFLOW_EMERGENCY_ESCALATION = "EMERGENCY_ESCALATION"
WORKFLOW_NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
WORKFLOW_MODERATOR_APPROVED = "MODERATOR_APPROVED"
WORKFLOW_UNABLE_TO_VERIFY = "UNABLE_TO_VERIFY"
WORKFLOW_ELIGIBLE = "ELIGIBLE"

# Every workflow_state value the gate understands. A new WORKFLOW_* constant
# must be added here (and to _REVIEW_CONCLUDED_STATES if it may clear review),
# otherwise test_workflow_states_are_registered fails in CI.
KNOWN_WORKFLOW_STATES = {
    WORKFLOW_ELIGIBLE,
    WORKFLOW_HIGH_RISK_HUMAN_REVIEW,
    WORKFLOW_EMERGENCY_ESCALATION,
    WORKFLOW_NEEDS_CLARIFICATION,
    WORKFLOW_MODERATOR_APPROVED,
    WORKFLOW_UNABLE_TO_VERIFY,
}

# States that conclude a human review and therefore clear the review block.
_REVIEW_CONCLUDED_STATES = {WORKFLOW_MODERATOR_APPROVED}

CODE_HUMAN_REVIEW_REQUIRED = "HUMAN_REVIEW_REQUIRED"
CODE_EMERGENCY_ESCALATION_ACTIVE = "EMERGENCY_ESCALATION_ACTIVE"
CODE_VERIFICATION_INCOMPLETE = "VERIFICATION_INCOMPLETE"
CODE_NYAYGUIDE_NOT_ELIGIBLE = "NYAYGUIDE_NOT_ELIGIBLE"

_MESSAGES = {
    CODE_HUMAN_REVIEW_REQUIRED: "This case is under priority human review. A specialist must complete the review before physical assistance can be requested.",
    CODE_EMERGENCY_ESCALATION_ACTIVE: "An emergency escalation is active on this case. Physical assistance requests are blocked.",
    CODE_VERIFICATION_INCOMPLETE: "Case verification is incomplete. Complete verification before requesting physical assistance.",
    CODE_NYAYGUIDE_NOT_ELIGIBLE: "On-ground NyayGuide support has not been approved for this case.",
}


def _parse_report(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def extract_structured_report(case_row: Dict[str, Any]) -> Dict[str, Any]:
    report = case_row.get("structured_report")
    if not isinstance(report, dict):
        report = _parse_report(report)
    return report if isinstance(report, dict) else {}


def _truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "required", "active"}
    return bool(value)


def verification_status_of(case_row: Dict[str, Any], report: Optional[Dict[str, Any]] = None) -> str:
    report = report if isinstance(report, dict) else extract_structured_report(case_row)
    status = case_row.get("ai_verification_status") or report.get("ai_verification_status") or "pending"
    return str(status).strip().lower()


def _support_need_server_approved(report: Dict[str, Any], status: str) -> bool:
    if _truthy(report.get("nyayguide_support_needed")):
        return True
    if _truthy(report.get("female_nyayguide_support_enabled")):
        return True
    risk_level = str(report.get("risk_level") or "").strip().lower()
    risk_flags = report.get("risk_flags") or []
    if isinstance(risk_flags, str):
        risk_flags = [risk_flags.lower()]
    elif isinstance(risk_flags, list):
        risk_flags = [str(f).strip().lower() for f in risk_flags]
    else:
        risk_flags = []
    has_summary = bool(str(report.get("summary") or "").strip())
    return (
        status in {VERIFIED_FOR_NEXT_STEP, "verified"}
        and has_summary
        and risk_level not in {"high"}
        and "sensitive" not in risk_flags
    )


def evaluate_nyayguide_eligibility(case_row: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluates whether an owned, confirmed case may create a NyayGuide request."""
    report = extract_structured_report(case_row or {})
    status = verification_status_of(case_row, report)
    workflow_state = str(report.get("workflow_state") or "").strip().upper()

    emergency_active = (
        workflow_state == WORKFLOW_EMERGENCY_ESCALATION
        or _truthy(report.get("emergency_escalation_active"))
    )
    if emergency_active:
        return {
            "allowed": False,
            "code": CODE_EMERGENCY_ESCALATION_ACTIVE,
            "message": _MESSAGES[CODE_EMERGENCY_ESCALATION_ACTIVE],
            "workflow_state": WORKFLOW_EMERGENCY_ESCALATION,
        }

    review_concluded = workflow_state in _REVIEW_CONCLUDED_STATES
    if workflow_state == WORKFLOW_UNABLE_TO_VERIFY:
        return {
            "allowed": False,
            "code": CODE_VERIFICATION_INCOMPLETE,
            "message": _MESSAGES[CODE_VERIFICATION_INCOMPLETE],
            "workflow_state": WORKFLOW_UNABLE_TO_VERIFY,
        }
    human_review_active = not review_concluded and (
        workflow_state == WORKFLOW_HIGH_RISK_HUMAN_REVIEW
        or status == "flagged"
        or _truthy(report.get("manual_review_required"))
        or _truthy(report.get("human_takeover_required"))
    )
    if human_review_active:
        return {
            "allowed": False,
            "code": CODE_HUMAN_REVIEW_REQUIRED,
            "message": _MESSAGES[CODE_HUMAN_REVIEW_REQUIRED],
            "workflow_state": WORKFLOW_HIGH_RISK_HUMAN_REVIEW,
        }

    if not review_concluded and status not in {VERIFIED_FOR_NEXT_STEP, "verified"}:
        return {
            "allowed": False,
            "code": CODE_VERIFICATION_INCOMPLETE,
            "message": _MESSAGES[CODE_VERIFICATION_INCOMPLETE],
            "workflow_state": WORKFLOW_NEEDS_CLARIFICATION,
        }

    if workflow_state == WORKFLOW_NEEDS_CLARIFICATION:
        return {
            "allowed": False,
            "code": CODE_VERIFICATION_INCOMPLETE,
            "message": _MESSAGES[CODE_VERIFICATION_INCOMPLETE],
            "workflow_state": WORKFLOW_NEEDS_CLARIFICATION,
        }

    if not _support_need_server_approved(report, status):
        return {
            "allowed": False,
            "code": CODE_NYAYGUIDE_NOT_ELIGIBLE,
            "message": _MESSAGES[CODE_NYAYGUIDE_NOT_ELIGIBLE],
            "workflow_state": WORKFLOW_ELIGIBLE,
        }

    return {
        "allowed": True,
        "code": None,
        "message": None,
        "workflow_state": WORKFLOW_ELIGIBLE,
    }


def build_nyayguide_suggestion(
    report: Dict[str, Any],
    *,
    support_needs_met: bool = False,
    case_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Builds a typed nyayguide_suggestion action for the suggestions rail.

    Returns an enabled action only when every server-side gate passes;
    returns a disabled action (with blocked_reason) for soft-fail states,
    or None for hard-block states (emergency / human review) where the UI
    must show its dedicated banner instead.
    """
    evaluation = evaluate_nyayguide_eligibility({"structured_report": report})
    action: Dict[str, Any] = {
        "id": f"nyayguide_suggestion:{case_id}" if case_id else "nyayguide_suggestion",
        "kind": "nyayguide_suggestion",
        "label": "Connect to Nyay Guide",
        "node": "sahayak",
        "payload": "Request Human Help",
        "requires_user_confirmation": True,
        "enabled": bool(evaluation["allowed"]) and bool(support_needs_met),
        "workflow_state": evaluation["workflow_state"],
        "blocked_reason": evaluation["code"],
    }
    if not evaluation["allowed"]:
        if evaluation["code"] in {CODE_EMERGENCY_ESCALATION_ACTIVE, CODE_HUMAN_REVIEW_REQUIRED}:
            return None
        action["enabled"] = False
        return action
    if not support_needs_met:
        action["enabled"] = False
        action["workflow_state"] = WORKFLOW_NEEDS_CLARIFICATION
        action["blocked_reason"] = CODE_VERIFICATION_INCOMPLETE
        return action
    return action
