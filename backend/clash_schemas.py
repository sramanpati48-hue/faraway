"""Pydantic models for Clash Mode API."""
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ClashMode(str, Enum):
    practice = "practice"
    real_life = "real_life"


class ClashPhase(str, Enum):
    opening = "opening"
    evidence = "evidence"
    legal_arguments = "legal_arguments"
    rebuttal = "rebuttal"
    closing = "closing"


AgentSide = Literal["prosecution", "defence", "judge", "system"]
UserRole = Literal["prosecution", "defence"]
UserAction = Literal["argue", "ask", "answer"]
QuestionTarget = Literal["user", "prosecution", "defence"]


class ClashCaseInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    facts: str = Field(..., min_length=10)
    mock_case_id: Optional[str] = None


class ClashMockCase(BaseModel):
    id: str
    title: str
    summary: str
    facts: str
    tags: List[str] = []


class ClashSessionCreate(BaseModel):
    mode: ClashMode
    user_id: Optional[str] = None
    user_role: UserRole = "prosecution"


class ParameterScore(BaseModel):
    parameter_id: str
    parameter_label: str
    prosecution_score: float = Field(ge=0, le=20)
    defence_score: float = Field(ge=0, le=20)
    winner: Literal["prosecution", "defence", "draw"] = "draw"
    rationale: str = ""


class JudgeScore(BaseModel):
    phase: Optional[str] = None
    legal_accuracy: float = Field(ge=0, le=20, default=0)
    coherence: float = Field(ge=0, le=20, default=0)
    evidence_usage: float = Field(ge=0, le=20, default=0)
    procedural_soundness: float = Field(ge=0, le=20, default=0)
    phase_fulfillment: float = Field(ge=0, le=20, default=0)
    round_total: float = Field(ge=0, le=100, default=0)
    bench_note: Optional[str] = None
    parameters: List[ParameterScore] = []
    prosecution_average: float = 0
    defence_average: float = 0
    round_winner: Literal["prosecution", "defence", "draw"] = "draw"

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "JudgeScore":
        params_raw = data.get("parameters") or []
        parameters = []
        for p in params_raw:
            if isinstance(p, dict):
                parameters.append(
                    ParameterScore(
                        parameter_id=str(p.get("parameter_id", "")),
                        parameter_label=str(p.get("parameter_label", "")),
                        prosecution_score=float(p.get("prosecution_score", 0)),
                        defence_score=float(p.get("defence_score", 0)),
                        winner=p.get("winner", "draw"),
                        rationale=str(p.get("rationale", "")),
                    )
                )
        rw = str(data.get("round_winner", "draw")).lower()
        if rw not in ("prosecution", "defence", "draw"):
            rw = "draw"
        return cls(
            phase=data.get("phase"),
            legal_accuracy=float(data.get("legal_accuracy", 0)),
            coherence=float(data.get("coherence", 0)),
            evidence_usage=float(data.get("evidence_usage", 0)),
            procedural_soundness=float(data.get("procedural_soundness", 0)),
            phase_fulfillment=float(data.get("phase_fulfillment", 0)),
            round_total=float(data.get("round_total", 0)),
            bench_note=data.get("bench_note"),
            parameters=parameters,
            prosecution_average=float(data.get("prosecution_average", 0)),
            defence_average=float(data.get("defence_average", 0)),
            round_winner=rw,
        )


class DebateRound(BaseModel):
    phase: ClashPhase
    prosecution_excerpt: str = ""
    defence_excerpt: str = ""
    judge_score: Optional[JudgeScore] = None


class FinalClashResult(BaseModel):
    overall_score: float = Field(ge=0, le=100)
    confidence_band: str
    mock_verdict: str
    declared_winner: Literal["prosecution", "defence", "draw"] = "draw"
    winner_explanation: str = ""
    actionability_notes: str = ""
    evidence_gaps: List[str] = []
    unresolved_questions: List[str] = []
    round_scores: List[JudgeScore] = []
    judge_parameters: List[Dict[str, Any]] = []
    parameter_totals: List[ParameterScore] = []
    prosecution_overall_average: float = 0
    defence_overall_average: float = 0


class ClashSession(BaseModel):
    session_id: str
    mode: ClashMode
    status: Literal["created", "case_ready", "debating", "paused", "completed", "error"] = "created"
    case_title: Optional[str] = None
    case_facts: Optional[str] = None
    mock_case_id: Optional[str] = None
    phase: Optional[ClashPhase] = None
    round_number: int = 0
    rounds: List[DebateRound] = []
    final_result: Optional[FinalClashResult] = None
    pending_question_id: Optional[str] = None
    pending_question: Optional[str] = None
    question_agent_side: Optional[AgentSide] = None
    user_role: UserRole = "prosecution"
    user_action: Optional[UserAction] = None
    ai_assist_allowed: bool = False
    question_target: Optional[QuestionTarget] = None
    user_id: Optional[str] = None


class ClashQuestionEvent(BaseModel):
    question_id: str
    question_text: str
    agent_side: AgentSide
    phase: ClashPhase
    quick_replies: List[str] = []
    user_action: Optional[UserAction] = None
    ai_assist_allowed: bool = False
    question_target: Optional[QuestionTarget] = None


class ClashAnswerRequest(BaseModel):
    question_id: str
    answer: Optional[str] = Field(default=None, min_length=1)
    delegate: bool = False

    @model_validator(mode="after")
    def require_answer_or_delegate(self):
        if self.delegate:
            return self
        if not (self.answer or "").strip():
            raise ValueError("Provide an answer or set delegate=true")
        return self


class ClashStreamEvent(BaseModel):
    event_type: str
    session_id: str
    mode: ClashMode
    agent_side: AgentSide = "system"
    phase: Optional[ClashPhase] = None
    content: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
