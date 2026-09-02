import re

with open("backend/voice/agent.py", "r", encoding="utf-8") as f:
    code = f.read()

# I will replace `process_user_turn` using regex or just text replacement since it's a bit long.
# Actually, it's easier to just append the new implementation and replace the old one.

new_process_user_turn = '''
    async def process_user_turn(self, user_text: str) -> Dict[str, Any]:
        """
        Executes one reasoning turn across cooperating sub-agents with validated action contract.
        Uses WorkflowState for routing.
        """
        self.state.turn_count += 1
        self.state.add_utterance("user", user_text)

        action_contract = detect_voice_action_intent(
            user_text,
            context=self.state.context_building or {},
            risk_flags=self.state.risk_flags,
        )

        if action_contract.action == ActionType.HUMAN_REVIEW and not action_contract.requires_confirmation:
            self.state.active_agent = "EscalationAgent"
            self.state.workflow_state = WorkflowState.EMERGENCY_ESCALATION
            spoken = action_contract.message or "Your safety is our top priority. If you are in immediate danger, please contact local emergency services immediately."
            self.state.add_utterance("assistant", spoken, "EscalationAgent")
            self._persist_current_state()
            return self._build_turn_response(spoken, action_contract)

        if action_contract.action == ActionType.REQUEST_NYAYGUIDE:
            if self.state.workflow_state in (WorkflowState.VERIFYING, WorkflowState.NEEDS_CLARIFICATION):
                spoken = "I understand you want on-ground assistance. I'm still verifying the details so I can guide you safely. I'll ask a few short questions first."
                self.state.add_utterance("assistant", spoken, "VerificationAgent")
                
                # Still ask verification question
                ver_spoken, _ = await self.verification_agent.evaluate_and_respond(user_text)
                final_spoken = f"{spoken} {ver_spoken}"
                self._persist_current_state()
                return self._build_turn_response(final_spoken, VoiceAgentAction(action=ActionType.NONE))
            else:
                self.state.workflow_state = WorkflowState.NYAYGUIDE_SUGGESTED
                spoken = (
                    "I can prepare a NyayGuide request for help with the process. "
                    "Please review and confirm the request before we search for a nearby NyayGuide."
                )
                self.state.add_utterance("assistant", spoken, "SupportAgent")
                self.state.workflow_state = WorkflowState.AWAITING_NYAYGUIDE_CONFIRMATION
                self._persist_current_state()
                return self._build_turn_response(spoken, action_contract)
                
        if self.state.turn_count == 1 and not user_text.strip():
            greeting = self._build_first_turn_greeting()
            self.state.active_agent = "VoiceModerator"
            self.state.add_utterance("assistant", greeting, "VoiceModerator")
            self._persist_current_state()
            return self._build_turn_response(greeting, VoiceAgentAction(action=ActionType.NONE))

        # Main Verification Loop
        if self.state.workflow_state in (WorkflowState.VERIFYING, WorkflowState.NEEDS_CLARIFICATION, WorkflowState.ASSESS_SUPPORT_NEED):
            self.state.active_agent = "VerificationAgent"
            spoken, score = await self.verification_agent.evaluate_and_respond(user_text)
            self.state.add_utterance("assistant", spoken, "VerificationAgent")
            self._persist_current_state()
            return self._build_turn_response(spoken, VoiceAgentAction(action=ActionType.NONE))

        # Support phase
        self.state.active_agent = "SupportAgent"
        spoken = await self.support_agent.evaluate_and_respond(user_text)
        self.state.add_utterance("assistant", spoken, "SupportAgent")
        
        should_esc, reason = self.escalation_agent.check_escalation_triggers(user_text)
        if should_esc:
            packet = await self.escalation_agent.build_handoff_packet(reason)
            await self.escalation_agent.execute_nyayguide_handoff(packet)

        self._persist_current_state()
        return self._build_turn_response(spoken, VoiceAgentAction(action=ActionType.NONE))

    def _build_turn_response(self, spoken: str, action: VoiceAgentAction) -> Dict[str, Any]:
        return {
            "status": "success",
            "spoken_response": spoken,
            "text": spoken,
            "action": action.action.value,
            "requires_confirmation": action.requires_confirmation,
            "assistance_type": action.assistance_type.value if action.assistance_type else None,
            "safe_task_summary": action.safe_task_summary,
            "escalation_reason": action.escalation_reason,
            "resolution_status": self.state.resolution_status,
            "workflow_state": self.state.workflow_state.value,
            "frontend_audio_state": "idle",
            "active_agent": self.state.active_agent,
            "confidence_score": self.state.confidence_score,
            "voice_profile": self.state.get_voice_profile(),
            "state": self.state.to_dict(),
        }
'''

# Find everything from async def process_user_turn to the end of process_audio_turn.
pattern = re.compile(r"    async def process_user_turn\(self, user_text: str\) -> Dict\[str, Any\]:.*?(?=    async def process_audio_turn)", re.DOTALL)
if pattern.search(code):
    new_code = pattern.sub(new_process_user_turn + "\n", code)
    with open("backend/voice/agent.py", "w", encoding="utf-8") as f:
        f.write(new_code)
    print("Replaced process_user_turn")
else:
    print("process_user_turn not found")
