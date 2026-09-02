import re

with open("backend/voice/agent.py", "r", encoding="utf-8") as f:
    code = f.read()

new_verification_agent = '''
class VerificationAgent:
    """
    Adaptive voice verification that assesses facts based on missing details, safety, case type,
    and routing need, instead of a rigid script. Does not label cases as 'fake' or 'genuine'.
    """
    def __init__(self, state: ConversationState) -> None:
        self.state = state

    async def evaluate_and_respond(self, user_text: str) -> Tuple[str, float]:
        ctx = self.state.context_building or {}
        prior_facts = json.dumps({
            "incident_type": ctx.get("incident_type"),
            "summary": ctx.get("summary"),
            "location": ctx.get("location"),
            "amount": ctx.get("amount_involved"),
            "verified_facts": self.state.verified_facts,
        }, default=str)

        prompt = (
            f"You are the NyaySahayak Adaptive Voice Verification Layer.\\n"
            f"Your role is to assess workflow readiness, completeness, consistency, safety, and routing suitability.\\n"
            f"DO NOT claim a case is genuine, fake, proven, credible, or legally valid.\\n"
            f"\\n"
            f"CRITICAL INSTRUCTIONS:\\n"
            f"1. ADAPTIVE CHECKLIST: Base your questions on what is missing from the known facts, considering safety, case type, routing need, and consistency.\\n"
            f"2. NEVER ask the user to repeat what they have already stated in the prior context.\\n"
            f"3. Do not follow a rigid script.\\n"
            f"4. If there are inconsistencies, gently ask for clarification.\\n"
            f"5. If there is immediate safety concern, trigger EMERGENCY_ESCALATION.\\n"
            f"6. If the case requires human legal review (e.g. trauma, complex corporate), trigger HIGH_RISK_HUMAN_REVIEW.\\n"
            f"7. If you cannot verify facts despite clarification, trigger UNABLE_TO_VERIFY.\\n"
            f"8. If information is consistent and sufficiently complete for next steps, trigger VERIFIED_FOR_NEXT_STEP.\\n"
            f"\\n"
            f"PRIOR CONTEXT: {prior_facts}\\n"
            f"User just said: \\"{user_text}\\"\\n"
            f"Voice conversation history: {json.dumps(self.state.transcript[-4:], default=str)}\\n"
            f"\\n"
            f"Respond with JSON:\\n"
            f"{{\\n"
            f'  "spoken_response": "your short spoken message to user",\\n'
            f'  "extracted_facts": {{"key": "value"}},\\n'
            f'  "workflow_state": "verifying" | "needs_clarification" | "verified_for_next_step" | "high_risk_human_review" | "unable_to_verify" | "emergency_escalation",\\n'
            f'  "confidence_boost": 0.15\\n'
            f"}}"
        )
        try:
            resp = llm.invoke([SystemMessage(content=prompt)])
            content = resp.content if isinstance(resp.content, str) else str(resp.content)
            clean = content.strip().replace("```json", "").replace("```", "").strip()
            data = json.loads(clean)
            
            spoken = data.get("spoken_response", "Thank you for explaining that. Let's continue.")
            if data.get("extracted_facts"):
                self.state.verified_facts.update(data["extracted_facts"])
                
            boost = float(data.get("confidence_boost", 0.1))
            new_score = round(min(1.0, self.state.confidence_score + boost), 2)
            
            next_state_str = str(data.get("workflow_state", "verifying")).upper()
            if hasattr(WorkflowState, next_state_str):
                self.state.workflow_state = WorkflowState[next_state_str]
            else:
                self.state.workflow_state = WorkflowState.VERIFYING
                
            if self.state.workflow_state == WorkflowState.VERIFIED_FOR_NEXT_STEP:
                self.state.workflow_state = WorkflowState.ASSESS_SUPPORT_NEED
                
            self.state.log_decision(
                "VerificationAgent",
                self.state.workflow_state.value,
                f"Confidence {new_score}; State transitioned to {self.state.workflow_state.value}",
            )
            return spoken, new_score
        except Exception as exc:
            print(f"VerificationAgent error: {exc}")
            self.state.log_decision("VerificationAgent", "error_fallback", f"LLM call failed — {exc}.")
            return (
                "Thank you for sharing that. I am updating your case record with these details.",
                min(1.0, self.state.confidence_score + 0.1),
            )
'''

# We need to replace the VerificationAgent class.
# I will use a regex to match from 'class VerificationAgent:' until 'class SupportAgent:'

pattern = re.compile(r"class VerificationAgent:.*?class SupportAgent:", re.DOTALL)
if pattern.search(code):
    new_code = pattern.sub(new_verification_agent + "\n\nclass SupportAgent:", code)
    with open("backend/voice/agent.py", "w", encoding="utf-8") as f:
        f.write(new_code)
    print("Replaced VerificationAgent")
else:
    print("VerificationAgent class not found or pattern mismatch")
