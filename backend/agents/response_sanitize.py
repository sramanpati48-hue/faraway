"""Strip internal classification blocks from user-facing chat text."""
from __future__ import annotations

import re
from typing import Any

_CLASSIFICATION_HEADING = re.compile(
    r"(?:^|\n)\s*#{0,3}\s*Classification Data\s*\(Internal\)\s*:?\s*",
    re.IGNORECASE,
)
_CLASSIFICATION_TAG = re.compile(
    r"\[(?:Cognizable|Complex_MLAT|Fraud_Under_10k)\s*:[^\]]*\]",
    re.IGNORECASE,
)
_INTERNAL_FLAGS_LINE = re.compile(
    r"(?:^|\n)\s*\[Cognizable:[^\]]+\]\s*(?:\n\s*\[Complex_MLAT:[^\]]+\])?\s*(?:\n\s*\[Fraud_Under_10k:[^\]]+\])?",
    re.IGNORECASE,
)


def strip_classification_block(text: Any) -> str:
    """Remove internal classification headings and tags from a chat reply."""
    raw = "" if text is None else str(text)
    if not raw.strip():
        return ""
    split = _CLASSIFICATION_HEADING.split(raw, maxsplit=1)
    cleaned = split[0] if split else raw
    cleaned = _INTERNAL_FLAGS_LINE.sub("", cleaned)
    cleaned = _CLASSIFICATION_TAG.sub("", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


def format_retrieved_section_lines(rows: list[dict] | None, *, limit: int = 4) -> str:
    lines: list[str] = []
    for row in (rows or [])[:limit]:
        if not isinstance(row, dict):
            continue
        act = str(row.get("act_name") or "").strip()
        section = str(row.get("section_number") or "").strip()
        title = str(row.get("title") or "").strip()
        if act and section:
            lines.append(f"- {act} § {section}" + (f" ({title})" if title else ""))
        elif act or title:
            lines.append(f"- {act or title}")
    return "\n".join(lines)
