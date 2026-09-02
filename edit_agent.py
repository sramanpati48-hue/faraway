import re

with open("backend/voice/agent.py", "r", encoding="utf-8") as f:
    code = f.read()

workflow_states_code = """
class WorkflowState(str, Enum):
    VERIFYING = "verifying"
    NEEDS_CLARIFICATION = "needs_clarification"
    VERIFIED_FOR_NEXT_STEP = "verified_for_next_step"
    HIGH_RISK_HUMAN_REVIEW = "high_risk_human_review"
    UNABLE_TO_VERIFY = "unable_to_verify"
    EMERGENCY_ESCALATION = "emergency_escalation"
    ASSESS_SUPPORT_NEED = "assess_support_need"
    NYAYGUIDE_SUGGESTED = "nyayguide_suggested"
    AWAITING_NYAYGUIDE_CONFIRMATION = "awaiting_nyayguide_confirmation"
    CALL_CENTRE_SCREENING = "call_centre_screening"
    SEARCHING = "searching"
    MATCHED = "matched"
    CANCELLED = "cancelled"
"""

if "class WorkflowState(str, Enum):" not in code:
    code = code.replace("class ActionType(str, Enum):", workflow_states_code + "\nclass ActionType(str, Enum):")

if "workflow_state: WorkflowState" not in code:
    code = code.replace("resolution_status: str = \"in_progress\"", "resolution_status: str = \"in_progress\"\n    workflow_state: WorkflowState = WorkflowState.VERIFYING\n    frontend_audio_state: str = \"idle\"")

with open("backend/voice/agent.py", "w", encoding="utf-8") as f:
    f.write(code)
print("Updated agent.py with basic states")
