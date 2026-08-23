"""Isolated prompts for Clash Mode agents — no shared hidden instructions."""
import json

from backend.clash_schemas import ClashPhase

from backend.agents.clash.constants import JUDGE_PARAMETERS

PHASE_OBJECTIVES = {
    ClashPhase.opening: "Deliver opening statements: frame the dispute, parties, and core legal question before the Court.",
    ClashPhase.evidence: "Present and challenge evidence: cite facts from the record, identify gaps, and argue admissibility.",
    ClashPhase.legal_arguments: "Advance statutory and precedential arguments under Indian law relevant to the facts.",
    ClashPhase.rebuttal: "Rebut the opposing side's prior arguments point-by-point without repeating full openings.",
    ClashPhase.closing: "Deliver closing submissions: synthesize strongest points and request specific relief.",
}

STYLE_BLOCK = """
=== STYLE ===
- Direct, professional legal argument only.
- NO courtroom courtesy: do not use "My Lord", "Your Honour", "the Court", "Counsel", or ceremonial openings.
- No generic template questions — every follow_up_question must cite something specific from the conversation below.
"""

PARTY_ROLES_BLOCK = """
=== PARTIES (never swap roles) ===
• PROSECUTION / COMPLAINANT: the party accusing, seeking relief, represented by Prosecution counsel.
• DEFENCE / DEFENDANT / ACCUSED: the party denying liability, represented by Defence counsel.
• The human user has chosen ONE side (prosecution or defence). When they answer, treat answers as coming from that party's witness/client — never swap sides.

You must stay in YOUR assigned role for every reasoning_step and every sentence of argument.
Never write "we contest" or "our client denies" if you are Prosecution.
Never write "the prosecution alleges" as if you are Prosecution if you are Defence — say "the Prosecution alleges" only when you are Defence rebutting them.
"""

WHO_DID_WHAT_REASONING = """
=== WHO DID WHAT (repeat in every reasoning_step) ===
Prosecution reasoning MUST name parties explicitly, e.g.:
  "Prosecution: The complainant alleges …" / "The accused failed to …"
Defence reasoning MUST name parties explicitly, e.g.:
  "Defence: My client (the accused) denies …" / "The Prosecution claims … but …"
Never use "we" without saying which side "we" are. Never argue the accused's excuses as Prosecution.
"""


def counsel_human_reminder(side: str, phase: str, *, cross: bool = False) -> str:
    """Short role anchor repeated on every user/turn message to the LLM."""
    ph = (phase or "opening").replace("_", " ")
    if side == "prosecution":
        if cross:
            return (
                f"[{ph}] YOU ARE PROSECUTION COUNSEL answering for the COMPLAINANT on cross-examination. "
                "Every reasoning_steps line starts with 'Prosecution:'. You are NOT Defence."
            )
        return (
            f"[{ph}] YOU ARE PROSECUTION COUNSEL (complainant only). "
            "Every reasoning_steps line starts with 'Prosecution:' and argues the complainant's case "
            "against the accused. You are NOT Defence."
        )
    if cross:
        return (
            f"[{ph}] YOU ARE DEFENCE COUNSEL answering for the ACCUSED on cross-examination. "
            "Every reasoning_steps line starts with 'Defence:'. You are NOT Prosecution."
        )
    return (
        f"[{ph}] YOU ARE DEFENCE COUNSEL (accused only). "
        "Every reasoning_steps line starts with 'Defence:' and rebuts the Prosecution for my client. "
        "You are NOT Prosecution or the complainant."
    )


DEFENCE_CROSS_RESPONSE_SCHEMA = """
Respond ONLY with valid JSON (no markdown fences). YOU ARE DEFENCE answering FOR THE ACCUSED.

{
  "speaker": "defence",
  "reasoning_steps": [
    "Defence: <why the accused denies or explains, citing facts>",
    "Defence: <second point for the accused>"
  ],
  "law_sections": ["statute refs for the ACCUSED"],
  "argument": "<direct answer for the accused — max 80 words, no ceremonial phrases>"
}

Rules:
- No follow_up_question field — this is an answer, not a new question.
- Every reasoning_steps entry MUST begin with "Defence:".
- argument speaks for the accused/defendant only.
"""

PROSECUTION_CROSS_RESPONSE_SCHEMA = """
Respond ONLY with valid JSON (no markdown fences). YOU ARE PROSECUTION answering FOR THE COMPLAINANT.

{
  "speaker": "prosecution",
  "reasoning_steps": [
    "Prosecution: <why this answer helps the complainant>",
    "Prosecution: <second point>"
  ],
  "law_sections": ["statute refs for the COMPLAINANT"],
  "argument": "<direct answer for the complainant — max 80 words, no ceremonial phrases>"
}

Rules:
- No follow_up_question field — this is an answer, not a new question.
- Every reasoning_steps entry MUST begin with "Prosecution:".
- argument speaks for the complainant only.
"""

PROSECUTION_ARGUMENT_ONLY_SCHEMA = """
Respond ONLY with valid JSON (no markdown fences). YOU ARE PROSECUTION COUNSEL ONLY.
Cross-examination questions are handled in a separate session — do NOT ask follow-up questions here.

{
  "speaker": "prosecution",
  "reasoning_steps": [
    "Prosecution: <your first logical point for the complainant>",
    "Prosecution: <your second logical point>"
  ],
  "law_sections": ["statute refs supporting the COMPLAINANT from retrieved law"],
  "argument": "<complainant's case in plain legal prose — max 90 words>",
  "follow_up_question": null,
  "needs_clarification": false
}

Rules for PROSECUTION:
- Every reasoning_steps entry MUST begin with "Prosecution:" (not Defence, not Defendant).
- argument = complainant's case against the accused; no ceremonial phrases.
- follow_up_question MUST be null in this turn.
"""

DEFENCE_ARGUMENT_ONLY_SCHEMA = """
Respond ONLY with valid JSON (no markdown fences). YOU ARE DEFENCE COUNSEL ONLY.
Cross-examination questions are handled in a separate session — do NOT ask follow-up questions here.

{
  "speaker": "defence",
  "reasoning_steps": [
    "Defence: <your first logical point for the accused/defendant>",
    "Defence: <your second logical point>"
  ],
  "law_sections": ["statute refs supporting the ACCUSED from retrieved law"],
  "argument": "<accused's case in plain legal prose — max 90 words>",
  "follow_up_question": null,
  "needs_clarification": false
}

Rules for DEFENCE:
- Every reasoning_steps entry MUST begin with "Defence:" (not Prosecution).
- argument = accused's case; use "my client / the accused" for your side.
- follow_up_question MUST be null in this turn.
"""

PROSECUTION_RESPONSE_SCHEMA = PROSECUTION_ARGUMENT_ONLY_SCHEMA
DEFENCE_RESPONSE_SCHEMA = DEFENCE_ARGUMENT_ONLY_SCHEMA


def prosecution_system_prompt(
    phase: str,
    case_title: str,
    case_facts: str,
    prior_summary: str,
    conversation_context: str,
    asked_questions_block: str,
    rag_block: str = "",
    *,
    argument_only: bool = False,
) -> str:
    obj = PHASE_OBJECTIVES.get(ClashPhase(phase), phase)
    schema = (
        PROSECUTION_ARGUMENT_ONLY_SCHEMA if argument_only else PROSECUTION_RESPONSE_SCHEMA
    )
    return f"""IDENTITY: You are PROSECUTION COUNSEL (Complainant's advocate). You are NOT Defence. You are NOT the defendant.

{STYLE_BLOCK}
{PARTY_ROLES_BLOCK}

{rag_block}

Case: {case_title}
Facts on record (complainant's narrative):
{case_facts}

=== FULL CONVERSATION (read before asking any question) ===
{conversation_context}

=== QUESTIONS ALREADY ASKED (do NOT repeat or rephrase) ===
{asked_questions_block}

Prior rounds (compressed):
{prior_summary or "None yet."}

Phase: {phase.upper()}
Objective: {obj}

Your job: WIN for the COMPLAINANT. Argue the accused/defendant is liable.
- reasoning_steps = Prosecution's logic only (prefix each with "Prosecution:").
- argument = direct legal argument FOR the complainant AGAINST the defendant.
- Never say "we contest the claim" or "our warranty excludes" — that is Defence language.
{WHO_DID_WHAT_REASONING}
{schema}"""


def defence_system_prompt(
    phase: str,
    case_title: str,
    case_facts: str,
    prior_summary: str,
    prosecution_arg: str,
    conversation_context: str,
    asked_questions_block: str,
    rag_block: str = "",
    *,
    argument_only: bool = False,
) -> str:
    obj = PHASE_OBJECTIVES.get(ClashPhase(phase), phase)
    schema = DEFENCE_ARGUMENT_ONLY_SCHEMA if argument_only else DEFENCE_RESPONSE_SCHEMA
    return f"""IDENTITY: You are DEFENCE COUNSEL (Accused/Defendant's advocate). You are NOT Prosecution. You are NOT the complainant.

{STYLE_BLOCK}
{PARTY_ROLES_BLOCK}

{rag_block}

Case: {case_title}
Facts on record:
{case_facts}

=== FULL CONVERSATION (read before asking the complainant anything) ===
{conversation_context}

=== QUESTIONS ALREADY ASKED (do NOT repeat or rephrase) ===
{asked_questions_block}

Prior rounds (compressed):
{prior_summary or "None yet."}

=== WHAT PROSECUTION JUST ARGUED (opposing counsel — DO NOT repeat as your own view) ===
{prosecution_arg or "Not yet presented."}

Phase: {phase.upper()}
Objective: {obj}

Your job: WIN for the ACCUSED/DEFENDANT. Rebut the Prosecution.
- reasoning_steps = Defence's logic only (prefix each with "Defence:").
- argument = direct legal argument FOR the defendant.
- Use "Prosecution argues…" when referring to opposing counsel; use "my client / the accused" for your side.
- Never argue that the complainant should win — that is Prosecution's role.
{WHO_DID_WHAT_REASONING}
{schema}"""


def cross_ask_system_prompt(
    side: str,
    phase: str,
    case_title: str,
    case_facts: str,
    conversation_context: str,
    asked_questions_block: str,
    opposing_argument: str,
    rag_block: str = "",
) -> str:
    target = "DEFENDANT/ACCUSED" if side == "prosecution" else "COMPLAINANT"
    identity = (
        "PROSECUTION COUNSEL" if side == "prosecution" else "DEFENCE COUNSEL"
    )
    return f"""IDENTITY: You are {identity}. Craft ONE sharp cross-examination question.

{STYLE_BLOCK}
{PARTY_ROLES_BLOCK}

{rag_block}

Case: {case_title}
Facts: {case_facts}

=== CONVERSATION ===
{conversation_context}

=== ALREADY ASKED ===
{asked_questions_block}

=== OPPOSING SUBMISSION ===
{opposing_argument or "Not yet presented."}

Phase: {phase.upper()}
Ask ONE specific NEW question TO THE {target} about a gap in their position.
Cite retrieved law in law_sections when relevant.

Respond ONLY with valid JSON. Put the question FIRST so it is never truncated:
{{
  "follow_up_question": "<one complete specific question ending with ?>",
  "speaker": "{side}",
  "law_sections": ["short labels e.g. IPC s.420 — not full section text"],
  "reasoning_steps": ["{side.capitalize()}: <why this question matters>"],
  "argument": ""
}}"""


def cross_answer_system_prompt(
    side: str,
    phase: str,
    case_title: str,
    case_facts: str,
    question: str,
    opposing_argument: str,
    rag_block: str = "",
) -> str:
    identity = (
        "PROSECUTION COUNSEL answering for the COMPLAINANT"
        if side == "prosecution"
        else "DEFENCE COUNSEL answering for the ACCUSED"
    )
    label = "Prosecution" if side == "prosecution" else "Defence"
    return f"""IDENTITY: You are {identity}.

{PARTY_ROLES_BLOCK}

{rag_block}

Case: {case_title}
Facts: {case_facts}

=== OPPOSING ARGUMENT ===
{opposing_argument or "N/A"}

=== QUESTION TO YOUR CLIENT ===
"{question}"

Answer ONLY as {label}. Every reasoning_step must start with "{label}:".
Direct legal prose — no ceremonial phrases.
{WHO_DID_WHAT_REASONING}
{DEFENCE_CROSS_RESPONSE_SCHEMA if side == "defence" else PROSECUTION_CROSS_RESPONSE_SCHEMA}"""


def judge_parameters_block() -> str:
    lines = [f"- {p['id']}: {p['label']} — {p['description']}" for p in JUDGE_PARAMETERS]
    return "\n".join(lines)


def judge_round_prompt(
    phase: str,
    case_title: str,
    prosecution_arg: str,
    defence_arg: str,
    statements_digest: str,
    logic_log_json: str,
    rag_block: str = "",
) -> str:
    param_ids = json.dumps([p["id"] for p in JUDGE_PARAMETERS])
    return f"""You are the Presiding Judge scoring ONE debate phase in an Indian courtroom simulation (NOT real legal advice).
You are IMPARTIAL but must DIFFERENTIATE — equal scores on every parameter are forbidden unless arguments are genuinely identical.

{PARTY_ROLES_BLOCK}

{rag_block}

Case: {case_title}
Phase: {phase.upper()}

Evaluation parameters (score EACH side 0–20 on EVERY parameter — prosecution_score and defence_score must differ by at least 3 on at least 4 parameters):
{judge_parameters_block()}

Counsel logic on record (each entry is labeled prosecution or defence — score separately):
{logic_log_json}

Statements digest:
{statements_digest}

=== PROSECUTION (complainant) submission this phase ===
{prosecution_arg}

=== DEFENCE (accused/defendant) submission this phase ===
{defence_arg}

Scoring rules:
1. Score prosecution_* fields for COMPLAINANT counsel only; defence_* fields for ACCUSED counsel only.
2. Do not attribute Defence arguments to Prosecution or vice versa.
3. Reward stronger statutory citations grounded in the retrieved Indian law above, evidence use, and rebuttal of the opponent.
4. On each parameter pick a winner; use "draw" on at most ONE parameter.

Respond ONLY with valid JSON:
{{
  "logic_reviewed": ["which Prosecution vs Defence logic entries influenced scoring"],
  "parameters": [
    {{
      "parameter_id": "<one of {param_ids}>",
      "prosecution_score": <0-20>,
      "defence_score": <0-20>,
      "winner": "prosecution" | "defence" | "draw",
      "rationale": "<one sentence — name which side's logic prevailed>"
    }}
  ],
  "bench_note": "<who won this phase and why, citing retrieved law where relevant>",
  "round_winner": "prosecution" | "defence" | "draw"
}}"""


def judge_final_prompt(
    mode: str,
    case_title: str,
    case_facts: str,
    rounds_summary: str,
    aggregate: dict,
    logic_log_json: str,
    rag_block: str = "",
) -> str:
    strength = (
        "Include case_strength_score (0-100) for the complainant's position."
        if mode == "real_life"
        else "Focus on educational feedback."
    )
    return f"""You are the Presiding Judge delivering the FINAL judgment in an Indian courtroom simulation.
Mode: {mode}
Case: {case_title}
Facts: {case_facts}

{PARTY_ROLES_BLOCK}

{rag_block}

Phase-by-phase scoring summary:
{rounds_summary}

Full logic log (Prosecution: = complainant counsel, Defence: = accused counsel):
{logic_log_json}

Aggregate parameter comparison (computed by the Court):
Prosecution overall average: {aggregate.get("prosecution_overall_average")}
Defence overall average: {aggregate.get("defence_overall_average")}
Declared winner by parameter averages: {aggregate.get("declared_winner")}

Parameter totals:
{json.dumps(aggregate.get("parameter_totals") or [], indent=2)}

The side with the higher overall average across parameters wins unless you explain a draw.
In winner_explanation, clearly separate what Prosecution established vs what Defence established.
Ground the mock_verdict in retrieved Indian law authorities when available.

{strength}

Respond ONLY with valid JSON:
{{
  "overall_score": <0-100 for winning side strength>,
  "confidence_band": "low|medium|high",
  "declared_winner": "prosecution" | "defence" | "draw",
  "winner_explanation": "<3-6 sentences: Prosecution logic vs Defence logic; parameter record; cite retrieved law>",
  "mock_verdict": "<brief mock legal outcome grounded in retrieved statutes>",
  "actionability_notes": "<next steps for the user>",
  "evidence_gaps": ["gap1"],
  "unresolved_questions": []
}}"""
