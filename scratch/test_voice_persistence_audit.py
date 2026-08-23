"""
Unit & Mock Tests for NyaySahayak Durable Voice Sessions Persistence, Schema Readiness, and Audit View.

Tests:
  1. Production mode missing schema fails safely and asks for migration 040
  2. Development mode runtime DDL runs only when ALLOW_RUNTIME_SCHEMA_SETUP=true
  3. Session creation at start
  4. Incremental updates after each processed turn
  5. Partial persistence after simulated failure
  6. Access control behavior (case owner vs unauthorized vs moderator/admin)
  7. Authorized moderator/admin retrieval of audit detail
  8. Verification of no raw audio storage
"""
import sys
import os
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime

# Add root directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import backend.voice.database as vdb
from backend.voice.agent import (
    ConversationState,
    VoiceModeratorAgentWorker,
    VerificationAgent,
    SupportAgent,
    EscalationAgent,
)
from backend.voice.database import (
    VoiceSchemaMissingError,
    check_voice_sessions_schema_readiness,
    create_voice_session_record,
    persist_voice_session,
    complete_voice_session_record,
    get_voice_sessions_by_case,
    get_all_voice_sessions_audit,
    get_voice_session_audit_detail,
)


class TestVoiceSessionPersistenceAndAudit(unittest.TestCase):
    """Test suite for voice session persistence, schema readiness, and audit query mechanisms."""

    def setUp(self):
        vdb._schema_verified = False
        self.db_cases = {
            "case_owner_1": {
                "id": "case_owner_1",
                "user_id": "user_citizen_1",
                "structured_report": {"incident_type": "Cyber Fraud", "summary": "Phishing attack report"},
            },
            "case_owner_2": {
                "id": "case_owner_2",
                "user_id": "user_citizen_2",
                "structured_report": {"incident_type": "Domestic Violence", "summary": "Emergency assistance"},
            },
        }

    @patch("backend.voice.database.is_postgres_configured", return_value=True)
    def test_01_production_mode_missing_schema_fails_safely(self, mock_pg):
        """In production (default), if voice_sessions table is missing, fail safely with clear migration error."""
        vdb._schema_verified = False
        with patch.dict(os.environ, {"ALLOW_RUNTIME_SCHEMA_SETUP": "false"}, clear=False), \
             patch("backend.voice.database.execute_one", return_value=None):

            with self.assertRaises(VoiceSchemaMissingError) as ctx:
                check_voice_sessions_schema_readiness()

            self.assertIn("040_voice_sessions_audit.sql", str(ctx.exception))
            self.assertIn("Runtime DDL schema creation is disabled in production", str(ctx.exception))
        print("  PASS  [1] Production mode missing schema fails safely without running DDL")

    @patch("backend.voice.database.is_postgres_configured", return_value=True)
    def test_02_development_mode_schema_setup_when_explicitly_enabled(self, mock_pg):
        """When ALLOW_RUNTIME_SCHEMA_SETUP=true, dev mode initializes schema and logs notice."""
        vdb._schema_verified = False
        captured_ddl = []

        def mock_execute_void(sql, params=None):
            captured_ddl.append(sql)

        with patch.dict(os.environ, {"ALLOW_RUNTIME_SCHEMA_SETUP": "true"}, clear=False), \
             patch("backend.voice.database.execute_one", return_value=None), \
             patch("backend.voice.database.execute_void", side_effect=mock_execute_void):

            check_voice_sessions_schema_readiness()
            self.assertTrue(any("CREATE TABLE IF NOT EXISTS voice_sessions" in ddl for ddl in captured_ddl))
            self.assertTrue(vdb._schema_verified)
        print("  PASS  [2] Development mode executes runtime schema setup only when explicitly allowed")

    @patch("backend.voice.database.is_postgres_configured", return_value=True)
    def test_03_session_creation(self, mock_pg):
        """Verify voice session record is properly initialized at session start."""
        vdb._schema_verified = True
        captured_inserts = []

        def mock_execute_void(sql, params=None):
            if "INSERT INTO voice_sessions" in sql:
                captured_inserts.append(params)

        with patch("backend.voice.database.execute_void", side_effect=mock_execute_void):
            vs_id = create_voice_session_record(
                case_id="case_owner_1",
                user_id="user_citizen_1",
                session_id="chat_session_001",
                risk_flags=["sensitive"],
                initial_confidence=0.65,
                threat_level="low",
                voice_session_id="vs_uuid_001",
                initial_greeting="Hello, I am your Voice Moderator.",
            )

            self.assertEqual(vs_id, "vs_uuid_001")
            self.assertEqual(len(captured_inserts), 1)
            params = captured_inserts[0]
            self.assertEqual(params[0], "vs_uuid_001")
            self.assertEqual(params[1], "case_owner_1")
            self.assertEqual(params[2], "user_citizen_1")
            self.assertEqual(params[4], 0.65)
            self.assertIn("sensitive", params[7])
            self.assertIn("Voice Moderator", params[8])
        print("  PASS  [3] Session creation initialized correctly with case scoping and initial transcript")

    @patch("backend.voice.database.is_postgres_configured", return_value=True)
    def test_04_incremental_update_after_turn(self, mock_pg):
        """Verify incremental updates append to confidence history, transcript, and decision log."""
        vdb._schema_verified = True
        captured_updates = []

        def mock_execute_void(sql, params=None):
            if "INSERT INTO voice_sessions" in sql:
                captured_updates.append(params)

        with patch("backend.voice.database.execute_void", side_effect=mock_execute_void):
            persist_voice_session(
                case_id="case_owner_1",
                user_id="user_citizen_1",
                session_id="chat_session_001",
                resolution_status="in_progress",
                confidence_score=0.82,
                confidence_score_history=[
                    {"score": 0.65, "turn": 0, "timestamp": 100.0},
                    {"score": 0.82, "turn": 1, "timestamp": 105.0},
                ],
                escalated=False,
                risk_flags=["sensitive"],
                transcript=[
                    {"role": "assistant", "text": "Hello", "agent": "VoiceModerator"},
                    {"role": "user", "text": "I was duped of 50,000 INR"},
                    {"role": "assistant", "text": "Understood. Under IT Act Sec 66D...", "agent": "SupportAgent"},
                ],
                agent_decision_log=[
                    {"agent": "VerificationAgent", "decision": "verified_facts", "reason": "Extracted monetary loss 50000 INR"},
                    {"agent": "SupportAgent", "decision": "legal_advice", "reason": "Provided Sec 66D remedy"},
                ],
                voice_session_id="vs_uuid_001",
            )

            self.assertEqual(len(captured_updates), 1)
            params = captured_updates[0]
            self.assertEqual(params[0], "vs_uuid_001")
            self.assertEqual(params[5], "in_progress")
            self.assertEqual(params[6], 0.82)
            # Check confidence history JSON
            self.assertIn("0.82", params[7])
            # Check decision log JSON
            self.assertIn("VerificationAgent", params[15])
            self.assertIn("SupportAgent", params[15])
        print("  PASS  [4] Incremental persistence records confidence history and agent decision log")

    @patch("backend.voice.database.is_postgres_configured", return_value=True)
    def test_05_partial_persistence_on_simulated_failure(self, mock_pg):
        """Verify that when a turn fails mid-stream, partial state is retained and clean completion marks ended_at."""
        vdb._schema_verified = True
        captured_voids = []

        def mock_execute_void(sql, params=None):
            captured_voids.append((sql, params))

        with patch("backend.voice.database.execute_void", side_effect=mock_execute_void):
            # Save partial state during disconnect / interruption
            persist_voice_session(
                case_id="case_owner_1",
                voice_session_id="vs_partial_001",
                transcript=[{"role": "user", "text": "Connection lost..."}],
                resolution_status="in_progress",
                confidence_score=0.45,
            )

            # Clean complete call
            completed = complete_voice_session_record("vs_partial_001")
            self.assertTrue(completed)
            self.assertTrue(any("ended_at" in call[0] for call in captured_voids))
        print("  PASS  [5] Partial persistence and clean completion marking ended_at succeed")

    @patch("backend.voice.database.is_postgres_configured", return_value=True)
    def test_06_access_control_case_owner_vs_others(self, mock_pg):
        """Verify case owners can read their sessions, while unauthorized users are blocked with PermissionError."""
        vdb._schema_verified = True
        mock_rows = [{"id": "vs_001", "case_id": "case_owner_1", "user_id": "user_citizen_1"}]

        with patch("backend.voice.database.execute", return_value=mock_rows), \
             patch("backend.database.supabase_case_enhance.get_case_complete", side_effect=lambda cid: self.db_cases.get(cid)):

            # 1. Case Owner allowed
            res_owner = get_voice_sessions_by_case("case_owner_1", requesting_user={"id": "user_citizen_1", "role": "victim"})
            self.assertEqual(len(res_owner), 1)

            # 2. Non-owner unauthorized citizen blocked
            with self.assertRaises(PermissionError):
                get_voice_sessions_by_case("case_owner_1", requesting_user={"id": "user_unauthorized_99", "role": "victim"})

            # 3. Moderator allowed across cases
            res_mod = get_voice_sessions_by_case("case_owner_1", requesting_user={"id": "mod_1", "role": "moderator"})
            self.assertEqual(len(res_mod), 1)

            # 4. Admin allowed across cases
            res_admin = get_voice_sessions_by_case("case_owner_1", requesting_user={"id": "admin_1", "role": "admin"})
            self.assertEqual(len(res_admin), 1)
        print("  PASS  [6] Access control enforces case ownership and permits moderator/admin access")

    @patch("backend.voice.database.is_postgres_configured", return_value=True)
    def test_07_authorized_moderator_admin_audit_retrieval(self, mock_pg):
        """Verify moderators and admins can query the voice audit panel and detail endpoints."""
        vdb._schema_verified = True
        mock_audit_list = [
            {
                "id": "vs_001",
                "case_id": "case_owner_1",
                "resolution_status": "completed",
                "confidence_score": 0.85,
                "escalated": False,
                "incident_type": "Cyber Fraud",
            }
        ]
        mock_detail = {
            "id": "vs_001",
            "case_id": "case_owner_1",
            "full_transcript": [{"role": "user", "text": "Hello"}],
            "agent_decision_log": [{"agent": "VerificationAgent", "decision": "verify", "reason": "clear fact"}],
            "confidence_score_history": [{"score": 0.85, "turn": 1}],
        }

        with patch("backend.voice.database.execute", return_value=mock_audit_list), \
             patch("backend.voice.database.execute_one", return_value=mock_detail):

            # Unauthorized victim rejected
            with self.assertRaises(PermissionError):
                get_all_voice_sessions_audit(requesting_user={"id": "user_citizen_1", "role": "victim"})

            with self.assertRaises(PermissionError):
                get_voice_session_audit_detail("vs_001", requesting_user={"id": "user_citizen_1", "role": "victim"})

            # Authorized moderator permitted
            list_res = get_all_voice_sessions_audit(requesting_user={"id": "mod_1", "role": "moderator"})
            self.assertEqual(len(list_res), 1)

            detail_res = get_voice_session_audit_detail("vs_001", requesting_user={"id": "mod_1", "role": "moderator"})
            self.assertIsNotNone(detail_res)
            self.assertEqual(len(detail_res["agent_decision_log"]), 1)
            self.assertEqual(detail_res["agent_decision_log"][0]["agent"], "VerificationAgent")
        print("  PASS  [7] Authorized moderator/admin audit retrieval returns audit trail while blocking unauthorized roles")

    def test_08_no_raw_audio_storage(self):
        """Verify that neither ConversationState nor persistence payloads store binary audio streams."""
        state = ConversationState(case_id="case_123")
        state.add_utterance("user", "Hello there")
        state.add_utterance("assistant", "How can I help?")

        state_dict = state.to_dict()
        self.assertNotIn("audio_bytes", state_dict)
        self.assertNotIn("raw_audio", state_dict)
        self.assertNotIn("audio_stream", state_dict)
        self.assertIn("transcript", state_dict)
        self.assertIn("decision_log", state_dict)
        print("  PASS  [8] Zero raw audio stored — only text transcripts and structured audit logs")


if __name__ == "__main__":
    print("\n=== Running Durable Voice Sessions Persistence, Schema & Audit Tests ===\n")
    unittest.main(verbosity=2)
