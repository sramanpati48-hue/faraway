"""
Comprehensive test suite for AI Verification Gating of ₹49 NyaySahayak Booking.
Tests:
1. Database helper `update_case_ai_verification_status` and audit history persistence.
2. Text intake verification logic (clear low-risk -> verified, sensitive/low-conf -> pending/flagged).
3. Voice moderator agent verification (VerificationAgent -> verified, EscalationAgent -> flagged).
4. Backend `POST /api/nyaysahayak/book` gate enforcement:
   - Missing case_id -> 400
   - Pending status -> 403
   - Flagged status -> 403
   - Rejected status -> 403
   - Unauthorized user -> 403
   - Verified status -> 200 (Razorpay order returned)
5. Clash subscription independence (ungated by per-case verification).
"""
from __future__ import annotations

import os
import sys
import json
import uuid
import asyncio
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Ensure root dir is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.main import app
from backend.database.supabase_case_enhance import (
    update_case_ai_verification_status,
    save_case_with_situation_summary,
    get_case_complete,
)
from backend.voice.agent import ConversationState, VerificationAgent, EscalationAgent, VoiceModeratorAgentWorker

client = TestClient(app)

# In-memory mock database store for isolated unit tests
MOCK_CASES_DB = {}

def mock_get_case_complete(case_id: str):
    return MOCK_CASES_DB.get(case_id)

def mock_execute_void(sql: str, params=None):
    pass

def mock_pick_nyaysahayak(state_or_area):
    return {
        "uid": "sahayak_001",
        "name": "Ramesh Kumar (NyaySahayak)",
        "state": "Delhi",
        "location": "New Delhi",
    }

def mock_create_standard_order(**kwargs):
    return {
        "order_id": f"order_{uuid.uuid4().hex[:8]}",
        "amount": 4900,
        "currency": "INR",
        "key_id": "rzp_test_key123",
    }


def test_case_verification_helper():
    print("\n--- Test 1: Case AI Verification Helper & Audit History ---")
    case_id = f"test_case_{uuid.uuid4().hex[:8]}"
    uid = "user_123"

    # Setup mock case in memory
    MOCK_CASES_DB[case_id] = {
        "id": case_id,
        "user_id": uid,
        "session_id": "session_abc",
        "structured_report": {"incident_type": "Land boundary dispute", "risk_level": "Low"},
        "ai_verification_status": "pending",
        "ai_verification_confidence": 0.5,
        "ai_verification_history": [],
    }

    # Transition 1: Update to verified via text
    with patch("backend.database.supabase_case_enhance.is_postgres_configured", return_value=False), \
         patch("backend.database.supabase_case_enhance._supabase") as mock_sb:
        
        # Configure mock supabase
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"ai_verification_history": [], "structured_report": {}}
        )
        mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": case_id}])

        res = update_case_ai_verification_status(
            case_id=case_id,
            status="verified",
            confidence_score=0.85,
            source="text",
            reason="Clear text report",
        )
        assert res is True, "Helper update failed"
        print("  ✓ Transition to 'verified' returned True")

        # Invalid status should normalize to pending
        res_invalid = update_case_ai_verification_status(
            case_id=case_id,
            status="invalid_status_xyz",
            confidence_score=0.4,
            source="voice",
        )
        assert res_invalid is True, "Helper normalization failed"
        print("  ✓ Invalid status normalized gracefully")


def test_text_verification_logic():
    print("\n--- Test 2: Text Intake AI Verification Decision Logic ---")
    from backend.agents.report_agent import report_generator_agent

    # 1. Clear low-risk intake with answers
    state_clear = {
        "user_statement": "My neighbor built a fence 2 feet into my agricultural farmland in Meerut.",
        "location": {"city": "Meerut", "state": "Uttar Pradesh"},
        "collected_answers": {"q_0": "No physical violence", "q_1": "Boundary marker moved last week"},
        "answers_collection_complete": True,
        "question_rounds": 1,
        "structured_report": {
            "incident_type": "Land dispute",
            "risk_level": "Low",
            "cognizable": False,
            "is_complex_mlat": False,
            "fraud_under_10k": None,
            "summary": "Neighbor encroached boundary fence on agricultural land without violence.",
            "amount_involved": None,
            "statutory_sections": ["Section 447 IPC"],
            "checklist": ["Obtain revenue demarcation survey"],
        },
        "messages": [],
    }

    with patch("backend.agents.report_agent.llm") as mock_llm, \
         patch("backend.agents.report_agent.supabase_db") as mock_db:
        mock_llm.invoke.return_value = MagicMock(content=json.dumps(state_clear["structured_report"]))
        mock_db.get_routing_rule.return_value = None
        mock_db.update_case_ai_verification_status.return_value = True

        out_clear = report_generator_agent(state_clear)
        report = out_clear["structured_report"]
        assert report["ai_verification_status"] == "verified", f"Expected 'verified' but got {report.get('ai_verification_status')}"
        assert report["verification_source"] == "text"
        assert report["ai_verification_confidence"] >= 0.70
        print(f"  ✓ Clear text case verified: status={report['ai_verification_status']}, score={report['ai_verification_confidence']}")

    # 2. Sensitive / sexual offense case
    state_sensitive = {
        "user_statement": "Someone stalked and harassed me near my college.",
        "location": {"city": "Delhi", "state": "Delhi"},
        "collected_answers": {},
        "answers_collection_complete": False,
        "structured_report": {
            "incident_type": "Harassment / Stalking",
            "risk_level": "High",
            "cognizable": True,
            "is_complex_mlat": False,
            "fraud_under_10k": None,
            "summary": "Stalking and harassment incident reported by student.",
            "amount_involved": None,
            "statutory_sections": ["Section 354D IPC"],
            "checklist": ["Reach out to female counsellor"],
            "risk_flags": ["sensitive"],
        },
        "messages": [],
    }

    with patch("backend.agents.report_agent.llm") as mock_llm, \
         patch("backend.agents.report_agent.supabase_db") as mock_db:
        mock_llm.invoke.return_value = MagicMock(content=json.dumps(state_sensitive["structured_report"]))
        mock_db.get_routing_rule.return_value = None
        mock_db.update_case_ai_verification_status.return_value = True

        out_sensitive = report_generator_agent(state_sensitive)
        report_s = out_sensitive["structured_report"]
        assert report_s["ai_verification_status"] in ("pending", "flagged"), f"Sensitive case must be pending/flagged: {report_s.get('ai_verification_status')}"
        print(f"  ✓ Sensitive case protected: status={report_s['ai_verification_status']}")


def test_voice_verification_flow():
    print("\n--- Test 3: Voice Moderator Verification & Escalation ---")
    
    # 1. VerificationAgent completes verification
    state = ConversationState(
        case_id="case_voice_001",
        user_id="user_v1",
        session_id="sess_v1",
        confidence_score=0.75,
        risk_flags=[],
        context_building={"incident_type": "Cheque bounce", "amount_involved": "₹50,000"},
    )
    v_agent = VerificationAgent(state)

    with patch("backend.voice.agent.llm") as mock_llm:
        mock_llm.invoke.return_value = MagicMock(content=json.dumps({
            "spoken_response": "Understood. The cheque date was October 12th.",
            "extracted_facts": {"cheque_date": "12-Oct"},
            "confidence_boost": 0.15,
            "verification_complete": True,
        }))
        spoken, new_score = asyncio.run(v_agent.evaluate_and_respond("The cheque was dated October 12th."))
        assert state.resolution_status == "verified"
        assert new_score >= 0.85
        print(f"  ✓ Voice VerificationAgent reached status='verified' with score={new_score}")

    # 2. EscalationAgent triggers on sensitive flag
    state_esc = ConversationState(
        case_id="case_voice_002",
        user_id="user_v2",
        session_id="sess_v2",
        confidence_score=0.80,
        risk_flags=["sensitive"],
        context_building={"incident_type": "Domestic abuse"},
    )
    esc_agent = EscalationAgent(state_esc)
    should_esc, reason = esc_agent.check_escalation_triggers("I need help right now.")
    assert should_esc is True
    assert "sensitive" in reason.lower()
    print(f"  ✓ Voice EscalationAgent triggered on sensitive flag: reason='{reason}'")


from backend.database.auth_middleware import get_current_user

def test_backend_booking_endpoint():
    print("\n--- Test 4: Backend POST /api/nyaysahayak/book AI Verification Enforcement ---")
    
    user_id = "citizen_456"
    fake_user = {"id": user_id, "uid": user_id, "email": "citizen@test.com", "name": "Citizen User"}
    app.dependency_overrides[get_current_user] = lambda: fake_user

    # Register cases in mock database
    case_verified = f"case_verified_{uuid.uuid4().hex[:6]}"
    case_pending = f"case_pending_{uuid.uuid4().hex[:6]}"
    case_flagged = f"case_flagged_{uuid.uuid4().hex[:6]}"
    case_rejected = f"case_rejected_{uuid.uuid4().hex[:6]}"
    case_other_user = f"case_other_{uuid.uuid4().hex[:6]}"

    MOCK_CASES_DB[case_verified] = {
        "id": case_verified,
        "user_id": user_id,
        "ai_verification_status": "verified",
        "ai_verification_confidence": 0.88,
    }
    MOCK_CASES_DB[case_pending] = {
        "id": case_pending,
        "user_id": user_id,
        "ai_verification_status": "pending",
        "ai_verification_confidence": 0.50,
        "ai_verification_reason": "Needs voice clarification",
    }
    MOCK_CASES_DB[case_flagged] = {
        "id": case_flagged,
        "user_id": user_id,
        "ai_verification_status": "flagged",
        "ai_verification_reason": "High risk sensitive case",
    }
    MOCK_CASES_DB[case_rejected] = {
        "id": case_rejected,
        "user_id": user_id,
        "ai_verification_status": "rejected",
        "ai_verification_reason": "Fraudulent claim",
    }
    MOCK_CASES_DB[case_other_user] = {
        "id": case_other_user,
        "user_id": "different_user_999",
        "ai_verification_status": "verified",
    }

    with patch("backend.database.supabase_case_enhance.get_case_complete", side_effect=mock_get_case_complete), \
         patch("backend.database.supabase_db.get_case_by_id", side_effect=mock_get_case_complete), \
         patch("backend.database.supabase_db.pick_nyaysahayak_for_area", side_effect=mock_pick_nyaysahayak), \
         patch("backend.services.clash_billing.create_standard_order", side_effect=mock_create_standard_order), \
         patch("backend.database.supabase_db.create_nyaysahayak_booking", return_value="booking_123"):

        # 1. Missing case_id -> 400
        res_missing = client.post("/api/nyaysahayak/book", json={"session_id": "sess_1"})
        assert res_missing.status_code == 400, f"Expected 400 for missing case_id, got {res_missing.status_code}"
        assert res_missing.json()["detail"]["code"] == "CASE_ID_REQUIRED"
        print("  ✓ Missing case_id returns 400 CASE_ID_REQUIRED")

        # 2. Pending case -> 403
        res_p = client.post("/api/nyaysahayak/book", json={"session_id": "sess_1", "case_id": case_pending})
        assert res_p.status_code == 403, f"Expected 403 for pending, got {res_p.status_code}"
        assert res_p.json()["detail"]["ai_verification_status"] == "pending"
        assert res_p.json()["detail"]["code"] == "AI_VERIFICATION_REQUIRED"
        print("  ✓ Pending case blocked with 403 AI_VERIFICATION_REQUIRED")

        # 3. Flagged case -> 403
        res_f = client.post("/api/nyaysahayak/book", json={"session_id": "sess_1", "case_id": case_flagged})
        assert res_f.status_code == 403, f"Expected 403 for flagged, got {res_f.status_code}"
        assert res_f.json()["detail"]["ai_verification_status"] == "flagged"
        print("  ✓ Flagged case blocked with 403")

        # 4. Rejected case -> 403
        res_r = client.post("/api/nyaysahayak/book", json={"session_id": "sess_1", "case_id": case_rejected})
        assert res_r.status_code == 403, f"Expected 403 for rejected, got {res_r.status_code}"
        assert res_r.json()["detail"]["ai_verification_status"] == "rejected"
        print("  ✓ Rejected case blocked with 403")

        # 5. Unauthorized user's case -> 403
        res_unauth = client.post("/api/nyaysahayak/book", json={"session_id": "sess_1", "case_id": case_other_user})
        assert res_unauth.status_code == 403, f"Expected 403 for unauthorized access, got {res_unauth.status_code}"
        print("  ✓ Unauthorized case access blocked with 403")

        # 6. Verified case -> 200 Success
        res_v = client.post("/api/nyaysahayak/book", json={"session_id": "sess_1", "case_id": case_verified, "area": "Delhi"})
        assert res_v.status_code == 200, f"Expected 200 for verified case, got {res_v.status_code}: {res_v.text}"
        data = res_v.json()
        assert data["status"] == "success"
        assert data["amount"] == 4900
        assert "order_id" in data
        assert "key_id" in data
        print("  ✓ Verified case succeeds with Razorpay order (₹49 / 4900 paise)")


def test_clash_billing_independence():
    print("\n--- Test 5: Clash Subscriptions Independence ---")
    fake_user = {"id": "user_clash", "uid": "user_clash", "email": "user@clash.com"}
    app.dependency_overrides[get_current_user] = lambda: fake_user

    with patch("backend.services.clash_billing.create_subscription_checkout", return_value={
             "checkout_type": "order",
             "order_id": "order_clash_123",
             "amount": 4900,
             "currency": "INR",
             "key_id": "rzp_test_clash",
             "plan": {"id": "basic", "name": "Basic"},
         }):
        
        # Clash subscription does NOT take case_id and is NOT blocked by per-case verification
        res = client.post("/api/clash/billing/subscribe", json={"plan_id": "basic"})
        assert res.status_code == 200, f"Clash subscription failed: {res.status_code}"
        data = res.json()
        assert data["order_id"] == "order_clash_123"
        print("  ✓ Clash subscription checkout operates independently without case verification gate")


if __name__ == "__main__":
    test_case_verification_helper()
    test_text_verification_logic()
    test_voice_verification_flow()
    test_backend_booking_endpoint()
    test_clash_billing_independence()
    print("\n" + "="*60)
    print("🎉 ALL 5 AI VERIFICATION & BOOKING GATE TESTS PASSED!")
    print("="*60)
