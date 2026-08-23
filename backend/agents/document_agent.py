import base64
import io
from typing import Any

from backend.utils import get_llm_for_task
from backend.agents.specialist_runner import more_specialists_remain, run_specialist

llm = get_llm_for_task("chat_agent.document")


def _decode_payload(raw: Any) -> bytes | None:
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()
    if "," in text and text.lower().startswith("data:"):
        text = text.split(",", 1)[1]
    try:
        return base64.b64decode(text, validate=False)
    except Exception:
        return None


def extract_attachment_text(item: dict) -> str:
    """Pull plain text from a chat attachment (inline text, PDF bytes, or base64)."""
    existing = str(item.get("text") or item.get("extracted_text") or "").strip()
    if existing:
        return existing[:12000]

    name = str(item.get("name") or "")
    ctype = str(item.get("content_type") or "").lower()
    blob = _decode_payload(item.get("content") or item.get("data") or item.get("base64"))
    if blob:
        is_pdf = "pdf" in ctype or name.lower().endswith(".pdf") or blob[:5] == b"%PDF-"
        if is_pdf:
            try:
                from pypdf import PdfReader

                reader = PdfReader(io.BytesIO(blob))
                pages = []
                for page in reader.pages[:12]:
                    pages.append(page.extract_text() or "")
                extracted = "\n".join(pages).strip()
                if extracted:
                    return extracted[:12000]
            except Exception as exc:
                print(f"   PDF extract failed for {name}: {exc}")
        if ctype.startswith("text/") or name.lower().endswith((".txt", ".md", ".csv", ".json")):
            return blob.decode("utf-8", errors="replace")[:12000]
    return ""


def document_agent(state):
    print("\nDOCUMENT AGENT ACTIVATED")
    atts = state.get("attachments") or []
    names = []
    texts = []
    enriched = []
    for item in atts:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "attachment")
        names.append(name)
        body = extract_attachment_text(item)
        row = dict(item)
        if body:
            row["extracted_text"] = body
            texts.append(f"{name}:\n{body[:4000]}")
        enriched.append(row)

    extra = ""
    if names:
        extra = "ATTACHED FILES:\n" + "\n".join(f"- {n}" for n in names)
        if texts:
            extra += "\n\nEXTRACTED TEXT:\n" + "\n\n".join(texts)
        else:
            extra += "\n\nNo extractable text was found. Describe what the file appears to be from the filename and ask the user to paste key lines if needed."
    full = (
        "Analyze the described or attached legal document. "
        "Summarize parties, dates, what the document is, and what the user should do next. "
        "Do not invent facts that are not in the text."
    )
    out = run_specialist(
        state,
        llm=llm,
        role_name="Document Analysis Agent",
        extra_context=extra,
        full_instructions=full,
    )
    analysis = out.get("legal_draft") or out.get("final_response") or ""
    out["document_analysis"] = analysis
    out["internal_notes"] = analysis
    out["attachments"] = enriched or atts
    if enriched:
        details = dict(state.get("user_details") or {})
        details["attachments"] = enriched
        out["user_details"] = details

    # First pass from supervisor: keep the PDF/read analysis internal so chat
    # only shows the next user-facing turn (question_processor / specialist).
    if state.get("awaiting_document_summary"):
        out["next_step"] = "supervisor"
        out["awaiting_document_summary"] = False
        out["document_reviewed"] = True
        out["chat_text"] = ""
        out["final_response"] = ""
        out["user_facing_delta"] = ""
        out["messages"] = []
        out["case_category"] = state.get("case_category") or "document"
        return out

    if more_specialists_remain(state):
        # Domain specialist will speak next; keep document internal.
        out["chat_text"] = ""
        out["final_response"] = ""
        out["user_facing_delta"] = ""
        out["messages"] = []
    else:
        visible = str(out.get("final_response") or "").strip()
        out["chat_text"] = visible
    out["case_category"] = state.get("case_category") or "document"
    return out
