"""Fixed evaluation rubric announced by the bench at the start of each debate."""

JUDGE_PARAMETERS = [
    {
        "id": "legal_accuracy",
        "label": "Legal Accuracy",
        "description": "Correctness of legal principles and factual alignment.",
    },
    {
        "id": "statutory_application",
        "label": "Indian Law Sections",
        "description": "Appropriate citation and application of IPC, CrPC, CPC, NI Act, etc.",
    },
    {
        "id": "coherence",
        "label": "Logical Coherence",
        "description": "Internal consistency and structure of the argument.",
    },
    {
        "id": "evidence_usage",
        "label": "Evidence Usage",
        "description": "Use of facts on record; identification of evidentiary gaps.",
    },
    {
        "id": "procedural_soundness",
        "label": "Procedural Soundness",
        "description": "Compliance with courtroom procedure and phase objectives.",
    },
]
