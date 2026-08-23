"""
ingest_gram_nyayalaya.py
------------------------
Dedicated ingestion script for:
  1. assets/gram nayalaya act 2008.pdf
  2. assets/test cases for gramnyayalays.pdf

Reuses helpers from ingest_legal_documents.py.
Embeds both PDFs and upserts chunks into the Supabase `legal_documents` table.

Usage:
    python scripts/ingest_gram_nyayalaya.py [--dry-run] [--replace-existing]
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from io import BytesIO
from typing import Any, Iterable, Optional

# Allow importing from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import ClientOptions, create_client

load_dotenv()

# ─── Config ──────────────────────────────────────────────────────────
EMBED_DIM = 768

# Gram Nyayalaya Act metadata
ACT_METADATA = {
    "gram_nyayalaya_act": {
        "act_name": "Gram Nyayalayas Act, 2008",
        "category": "Rural Justice",
        "authority": "Ministry of Law and Justice",
        "year_introduced": 2008,
        "year_amendment": None,
        "legal_status": "active",
        "source_url": "assets/gram nayalaya act 2008.pdf",
        "related_acts": ["Code of Civil Procedure, 1908", "Code of Criminal Procedure, 1973"],
    },
    "test_cases": {
        "act_name": "Gram Nyayalayas Act, 2008 — Test Cases",
        "category": "Rural Justice",
        "authority": "Ministry of Law and Justice",
        "year_introduced": 2008,
        "year_amendment": None,
        "legal_status": "active",
        "source_url": "assets/test cases for gramnyayalays.pdf",
        "related_acts": ["Gram Nyayalayas Act, 2008"],
    },
}

# Regex helpers (same as ingest_legal_documents.py)
SECTION_HEADER_RE = re.compile(
    r"^\s*(?:Section|Sec\.?|Article|Art\.?|Rule|Chapter|Part)\s+([A-Za-z0-9\-\.()]+)\s*[:\-\.]?\s*(.*)$",
    re.IGNORECASE,
)
INLINE_SECTION_RE = re.compile(
    r"\b(?:Section|Sec\.?|Article|Art\.?|Rule)\s+([A-Za-z0-9\-\.()]+)\b",
    re.IGNORECASE,
)
PUNISHMENT_RE = re.compile(
    r"\b(punish(?:able|ment)?|imprison(?:ment)?|fine|penalt(?:y|ies)|liable)\b",
    re.IGNORECASE,
)
STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "under", "shall", "may",
    "any", "all", "not", "are", "was", "were", "have", "has", "had", "into", "such",
    "law", "act", "section", "rule", "chapter", "part", "article", "india", "indian",
}


# ─── Helpers ─────────────────────────────────────────────────────────

def _safe_text(v: Any) -> str:
    return str(v or "").strip()


def _to_pgvector(values: list) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def _extract_pdf_pages(pdf_path: str) -> list:
    with open(pdf_path, "rb") as f:
        reader = PdfReader(f)
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            text = text.replace("\x00", "")  # strip null bytes — PostgreSQL rejects \u0000
            text = re.sub(r"\s+", " ", text).strip()
            pages.append(text)
    return pages


def _split_into_section_blocks(
    page_texts: list,
    min_chunk_chars: int = 900,
    max_chunk_chars: int = 2600,
) -> list:
    """Identical to ingest_legal_documents._split_into_section_blocks."""
    blocks = []
    current_section_num = None
    current_section_title = None
    current_start_page = 1
    buffer_parts: list = []

    def flush(end_page: int) -> None:
        nonlocal buffer_parts, current_start_page
        if not buffer_parts:
            return
        text = " ".join(p for p in buffer_parts if p).strip()
        if not text:
            buffer_parts = []
            return
        if len(text) <= max_chunk_chars:
            blocks.append((text, current_section_num, current_section_title, current_start_page, end_page))
        else:
            start = 0
            while start < len(text):
                end = min(start + max_chunk_chars, len(text))
                if end < len(text):
                    split_pos = text.rfind(" ", start + min_chunk_chars, end)
                    if split_pos > start + (min_chunk_chars // 2):
                        end = split_pos
                part = text[start:end].strip()
                if part:
                    blocks.append((part, current_section_num, current_section_title, current_start_page, end_page))
                if end >= len(text):
                    break
                start = max(end - 180, start + 1)
        buffer_parts = []
        current_start_page = end_page

    for page_index, page_text in enumerate(page_texts, start=1):
        if not page_text:
            continue
        sentences = re.split(r"(?<=[\.!?])\s+", page_text)
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            header_match = SECTION_HEADER_RE.match(sentence)
            if header_match:
                flush(page_index)
                current_section_num = header_match.group(1).strip() or None
                title = header_match.group(2).strip()
                current_section_title = title or f"Section {current_section_num}"
                current_start_page = page_index
            if not current_section_num:
                inline = INLINE_SECTION_RE.search(sentence)
                if inline:
                    current_section_num = inline.group(1).strip()
                    if not current_section_title:
                        current_section_title = f"Section {current_section_num}"
            buffer_parts.append(sentence)
            if sum(len(x) for x in buffer_parts) >= max_chunk_chars:
                flush(page_index)

    flush(len(page_texts) if page_texts else 1)

    return [
        (t, sn, st, max(1, sp), max(sp, ep))
        for t, sn, st, sp, ep in blocks
        if len(t.strip()) >= 120
    ]


def _extract_keywords(text: str, title: str, max_kw: int = 12) -> list:
    tokens = re.findall(r"[A-Za-z][A-Za-z\-]{2,}", f"{title} {text}".lower())
    filtered = [t for t in tokens if t not in STOPWORDS]
    return [w for w, _ in Counter(filtered).most_common(max_kw)]


def _extract_punishments(text: str) -> Optional[str]:
    candidates = re.split(r"(?<=[\.!?])\s+", text)
    matches = [c.strip() for c in candidates if PUNISHMENT_RE.search(c)]
    return " ".join(matches[:3])[:1200] if matches else None


def _build_chunks(meta: dict, page_texts: list) -> list:
    blocks = _split_into_section_blocks(page_texts)
    if not blocks:
        joined = " ".join(p for p in page_texts if p).strip()
        if joined:
            blocks = [(joined[:2600], None, "Overview", 1, max(1, len(page_texts)))]

    act_name = meta["act_name"]
    chunks = []
    for idx, (content, section_number, subsection_text, start_page, end_page) in enumerate(blocks, start=1):
        title = (subsection_text or f"{act_name} — Block {idx}").strip()[:260]
        fingerprint = hashlib.sha256(
            f"{act_name}|{section_number or ''}|{start_page}|{end_page}|{content[:500]}".encode()
        ).hexdigest()[:24]
        chunk_id = f"{act_name[:36]}::{fingerprint}"

        summary = re.split(r"(?<=[\.!?])\s+", content)
        summary_text = " ".join(summary[:2]).strip()[:900] if summary else content[:900]

        applicable_sections = [section_number] if section_number else None

        row = {
            "document_name": act_name,
            "act_name": act_name,
            "category": meta["category"],
            "year_introduced": meta["year_introduced"],
            "year_amendment": meta["year_amendment"],
            "section_number": section_number,
            "subsection_text": subsection_text,
            "title": title,
            "content": content,
            "summary": summary_text,
            "authority": meta["authority"],
            "jurisdiction": "India",
            "legal_status": meta["legal_status"],
            "related_acts": meta["related_acts"] or None,
            "keywords": _extract_keywords(content, title),
            "severity_level": None,
            "applicable_sections": applicable_sections,
            "punishments": _extract_punishments(content),
            "source_url": meta["source_url"],
            "source_type": "local_pdf",
            "pdf_page_reference": f"p.{start_page}-{end_page}",
            "version": "1.0",
            "language": "en",
            "created_by": "script:ingest_gram_nyayalaya",
            "notes": None,
            "_chunk_id": chunk_id,
            "_content_for_embed": content,
        }
        chunks.append(row)
    return chunks


def _embed_chunks(
    chunks: list,
    embed_url: str = "",
    timeout: int = 90,
    max_retries: int = 4,
) -> dict:
    import time

    if not embed_url:
        from backend.services.text_embeddings import embed_texts

        last_exc: Exception | None = None
        delays = [5, 15, 30, 45]
        for attempt in range(max_retries):
            try:
                texts = [c["_content_for_embed"] for c in chunks]
                vecs = embed_texts(texts, task_type="RETRIEVAL_DOCUMENT")
                if len(vecs) != len(chunks):
                    raise ValueError(f"Embedding count mismatch: {len(vecs)} != {len(chunks)}")
                return {c["_chunk_id"]: vec for c, vec in zip(chunks, vecs)}
            except Exception as exc:  # noqa: BLE001
                wait = delays[min(attempt, len(delays) - 1)]
                print(
                    f"[WARN] Admin embed failed on attempt {attempt + 1}/{max_retries}: {exc}. "
                    f"Retrying in {wait}s…"
                )
                last_exc = exc
                time.sleep(wait)
        raise RuntimeError(f"Embedding failed after {max_retries} attempts.") from last_exc

    payload = {
        "chunks": [
            {
                "id": c["_chunk_id"],
                "text": c["_content_for_embed"],
                "metadata": {
                    "act_name": c["act_name"],
                    "section_number": c["section_number"],
                    "title": c["title"],
                },
            }
            for c in chunks
        ],
        "normalize": True,
    }
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"}

    delays = [5, 15, 30, 45]
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            response = requests.post(embed_url, headers=headers, data=encoded, timeout=timeout)
            response.raise_for_status()
            items = response.json()
            if not isinstance(items, list):
                raise ValueError("Embedding API returned non-list response.")
            vectors: dict = {}
            for item in items:
                chunk_id = _safe_text(item.get("id"))
                embedding = item.get("embedding")
                if not chunk_id or not isinstance(embedding, list):
                    continue
                if len(embedding) != EMBED_DIM:
                    raise ValueError(f"Embedding dim mismatch for {chunk_id}: {len(embedding)} != {EMBED_DIM}")
                vectors[chunk_id] = [float(v) for v in embedding]
            return vectors
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "?"
            wait = delays[min(attempt, len(delays) - 1)]
            print(f"[WARN] Embed API HTTP {status} on attempt {attempt + 1}/{max_retries}. "
                  f"Retrying in {wait}s (Space may be waking up)…")
            last_exc = exc
            time.sleep(wait)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            wait = delays[min(attempt, len(delays) - 1)]
            print(f"[WARN] Embed API connection error on attempt {attempt + 1}/{max_retries}: {exc}. "
                  f"Retrying in {wait}s…")
            last_exc = exc
            time.sleep(wait)

    raise RuntimeError(f"Embedding API failed after {max_retries} attempts.") from last_exc



def _chunked(items: list, batch_size: int) -> Iterable:
    batch: list = []
    for item in items:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def _init_supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    opts = ClientOptions(headers={"Accept-Charset": "utf-8", "Content-Type": "application/json; charset=utf-8"})
    return create_client(url, key, options=opts)


def ingest(
    assets_dir: str = "assets",
    embed_url: str = "",
    embed_batch: int = 18,
    insert_batch: int = 50,
    dry_run: bool = False,
    replace_existing: bool = True,
) -> None:
    pdf_specs = [
        ("gram_nyayalaya_act", os.path.join(assets_dir, "gram nayalaya act 2008.pdf")),
        ("test_cases", os.path.join(assets_dir, "test cases for gramnyayalays.pdf")),
    ]

    all_chunks: list = []

    for key, pdf_path in pdf_specs:
        meta = ACT_METADATA[key]
        if not os.path.isfile(pdf_path):
            print(f"[WARN] PDF not found, skipping: {pdf_path}")
            continue
        print(f"[INFO] Extracting: {pdf_path}")
        pages = _extract_pdf_pages(pdf_path)
        if not any(p.strip() for p in pages):
            print(f"[WARN] No extractable text in {pdf_path} (may be scanned). Skipping.")
            continue
        chunks = _build_chunks(meta, pages)
        print(f"[INFO]   -> {len(chunks)} chunks from {meta['act_name']}")
        all_chunks.extend(chunks)

    print(f"[INFO] Total chunks prepared: {len(all_chunks)}")

    if dry_run:
        print("[DRY-RUN] Skipping embedding and DB insert.")
        return

    if not all_chunks:
        print("[WARN] No chunks to insert.")
        return

    supabase = _init_supabase()

    if replace_existing:
        distinct_acts = sorted({c["act_name"] for c in all_chunks})
        for act_name in distinct_acts:
            print(f"[INFO] Clearing old chunks for: {act_name}")
            supabase.table("legal_documents").delete().eq("act_name", act_name).execute()

    inserted = 0
    for embed_group in _chunked(all_chunks, embed_batch):
        vectors = _embed_chunks(embed_group, embed_url=embed_url)
        rows = []
        for chunk in embed_group:
            vec = vectors.get(chunk["_chunk_id"])
            if not vec:
                print(f"[WARN] No embedding for chunk {chunk['_chunk_id']}, skipping.")
                continue
            row = {k: v for k, v in chunk.items() if not k.startswith("_")}
            row["embedding"] = _to_pgvector(vec)
            rows.append(row)

        for row_batch in _chunked(rows, insert_batch):
            supabase.table("legal_documents").insert(row_batch).execute()
            inserted += len(row_batch)
            print(f"[INFO] Inserted {inserted}/{len(all_chunks)}")

    print(f"[DONE] Gram Nyayalaya ingestion complete. {inserted} rows inserted.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest Gram Nyayalaya Act 2008 PDFs into Supabase.")
    parser.add_argument("--assets-dir", default="assets", help="Directory containing the PDF files")
    parser.add_argument(
        "--embed-url",
        default="",
        help="Optional /embed URL override. Empty = admin ai_embeddings.",
    )
    parser.add_argument("--embed-batch", type=int, default=18)
    parser.add_argument("--insert-batch", type=int, default=50)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--replace-existing", dest="replace_existing", action="store_true", default=True)
    parser.add_argument("--no-replace-existing", dest="replace_existing", action="store_false")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    ingest(
        assets_dir=args.assets_dir,
        embed_url=args.embed_url,
        embed_batch=args.embed_batch,
        insert_batch=args.insert_batch,
        dry_run=args.dry_run,
        replace_existing=args.replace_existing,
    )
