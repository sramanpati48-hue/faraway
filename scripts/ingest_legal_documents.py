import argparse
import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from typing import Any, Iterable, Optional

import requests
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import ClientOptions, create_client

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

load_dotenv()

EMBED_DIM = 768
SECTION_HEADER_RE = re.compile(
    r"^\s*(?:Section|Sec\.?|Article|Art\.?|Rule|Chapter|Part)\s+([A-Za-z0-9\-\.()]+)\s*[:\-\.)]?\s*(.*)$",
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
YEAR_RANGE_RE = re.compile(r"(\d{4})\s*[–-]\s*(\d{4}|Present)", re.IGNORECASE)
STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "under", "shall", "may",
    "any", "all", "not", "are", "was", "were", "have", "has", "had", "into", "such",
    "law", "act", "section", "rule", "chapter", "part", "article", "india", "indian",
}


@dataclass
class CsvLawRecord:
    act_name: str
    description: str
    category: str
    coverage: str
    authority: str
    source_url: str


@dataclass
class SectionChunk:
    chunk_id: str
    act_name: str
    category: str
    authority: str
    document_name: str
    title: str
    content: str
    section_number: Optional[str]
    subsection_text: Optional[str]
    start_page: int
    end_page: int
    year_introduced: Optional[int]
    year_amendment: Optional[int]
    legal_status: Optional[str]
    related_acts: list[str]
    keywords: list[str]
    punishments: Optional[str]
    source_url: str
    source_type: str


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _to_pgvector(values: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def _read_law_csv(csv_path: str) -> list[CsvLawRecord]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as file:
        lines = [line for line in file.read().splitlines() if line.strip()]

    header_index = -1
    for idx, line in enumerate(lines):
        if "Act Name" in line and "Official PDF Link" in line:
            header_index = idx
            break

    if header_index < 0:
        raise ValueError("Could not find CSV header row containing 'Act Name' and 'Official PDF Link'.")

    body = "\n".join(lines[header_index:])
    reader = csv.DictReader(body.splitlines())

    records: list[CsvLawRecord] = []
    for row in reader:
        act_name = _safe_text(row.get("Act Name"))
        source_url = _safe_text(row.get("Official PDF Link"))
        if not act_name or not source_url:
            continue

        records.append(
            CsvLawRecord(
                act_name=act_name,
                description=_safe_text(row.get("Description")),
                category=_safe_text(row.get("Category")) or "General",
                coverage=_safe_text(row.get("Coverage")),
                authority=_safe_text(row.get("Authority")) or "Unknown",
                source_url=source_url,
            )
        )

    return records


def _parse_years(coverage: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
    if not coverage:
        return None, None, None

    match = YEAR_RANGE_RE.search(coverage)
    if not match:
        return None, None, None

    intro = int(match.group(1))
    amendment_raw = match.group(2)
    if amendment_raw.lower() == "present":
        return intro, None, "active"

    amendment = int(amendment_raw)
    if amendment >= datetime.now().year:
        return intro, amendment, "active"
    return intro, amendment, "historical"


def _derive_related_acts(records: list[CsvLawRecord]) -> dict[str, list[str]]:
    by_category: dict[str, list[str]] = defaultdict(list)
    for record in records:
        by_category[record.category].append(record.act_name)

    related: dict[str, list[str]] = {}
    for record in records:
        siblings = [name for name in by_category[record.category] if name != record.act_name]

        replaces = []
        desc_lower = record.description.lower()
        if "replaces" in desc_lower:
            for candidate in records:
                if candidate.act_name == record.act_name:
                    continue
                short = candidate.act_name.lower().replace(",", "")
                if short.split(" ")[0] in desc_lower or candidate.act_name.lower() in desc_lower:
                    replaces.append(candidate.act_name)

        merged = []
        for name in replaces + siblings[:3]:
            if name not in merged:
                merged.append(name)
        related[record.act_name] = merged

    return related


def _download_pdf(url: str, timeout: int = 35) -> bytes:
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    content_type = response.headers.get("Content-Type", "")
    if "pdf" not in content_type.lower() and not url.lower().endswith(".pdf"):
        if b"%PDF" not in response.content[:1024]:
            raise ValueError(f"URL does not appear to be a PDF: {url}")
    return response.content


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def _find_local_pdf(record: CsvLawRecord, local_pdf_dir: Optional[str]) -> Optional[str]:
    if not local_pdf_dir:
        return None

    base_dir = os.path.abspath(local_pdf_dir)
    if not os.path.isdir(base_dir):
        return None

    candidate_paths: list[str] = []

    source_basename = os.path.basename(record.source_url.split("?")[0].strip())
    if source_basename.lower().endswith(".pdf"):
        candidate_paths.append(os.path.join(base_dir, source_basename))

    act_no_comma = record.act_name.replace(",", "")
    for stem in {
        record.act_name,
        act_no_comma,
        _normalize_key(record.act_name),
        _normalize_key(act_no_comma),
    }:
        candidate_paths.append(os.path.join(base_dir, f"{stem}.pdf"))

    for path in candidate_paths:
        if os.path.isfile(path):
            return path

    act_tokens = set(token for token in _normalize_key(act_no_comma).split("_") if token)
    best_path: Optional[str] = None
    best_score = 0
    for file_name in os.listdir(base_dir):
        if not file_name.lower().endswith(".pdf"):
            continue
        name_tokens = set(token for token in _normalize_key(os.path.splitext(file_name)[0]).split("_") if token)
        score = len(act_tokens.intersection(name_tokens))
        if score > best_score:
            best_score = score
            best_path = os.path.join(base_dir, file_name)

    if best_path and best_score >= 2:
        return best_path

    return None


def _extract_pdf_pages(pdf_bytes: bytes) -> list[str]:
    reader = PdfReader(BytesIO(pdf_bytes))
    pages: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        text = re.sub(r"\s+", " ", text).strip()
        pages.append(text)
    return pages


def _split_into_section_blocks(page_texts: list[str], min_chunk_chars: int, max_chunk_chars: int) -> list[tuple[str, Optional[str], Optional[str], int, int]]:
    blocks: list[tuple[str, Optional[str], Optional[str], int, int]] = []

    current_section_num: Optional[str] = None
    current_section_title: Optional[str] = None
    current_start_page = 1
    buffer_parts: list[str] = []

    def flush(end_page: int) -> None:
        nonlocal buffer_parts, current_start_page
        if not buffer_parts:
            return
        text = " ".join(part for part in buffer_parts if part).strip()
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
                inline_match = INLINE_SECTION_RE.search(sentence)
                if inline_match:
                    current_section_num = inline_match.group(1).strip()
                    if not current_section_title:
                        current_section_title = f"Section {current_section_num}"

            buffer_parts.append(sentence)
            if sum(len(x) for x in buffer_parts) >= max_chunk_chars:
                flush(page_index)

    flush(len(page_texts) if page_texts else 1)

    normalized: list[tuple[str, Optional[str], Optional[str], int, int]] = []
    for text, sec_num, sec_title, start_pg, end_pg in blocks:
        cleaned = text.strip()
        if len(cleaned) < 120:
            continue
        normalized.append((cleaned, sec_num, sec_title, max(1, start_pg), max(start_pg, end_pg)))

    return normalized


def _extract_keywords(text: str, title: str, max_keywords: int = 12) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z\-]{2,}", f"{title} {text}".lower())
    filtered = [token for token in tokens if token not in STOPWORDS]
    counts = Counter(filtered)
    keywords = [word for word, _ in counts.most_common(max_keywords)]
    return keywords


def _extract_punishments(text: str) -> Optional[str]:
    candidates = re.split(r"(?<=[\.!?])\s+", text)
    matches = [c.strip() for c in candidates if PUNISHMENT_RE.search(c)]
    if not matches:
        return None
    return " ".join(matches[:3])[:1200]


def _build_chunks_for_record(
    record: CsvLawRecord,
    related_acts: list[str],
    min_chunk_chars: int,
    max_chunk_chars: int,
    local_pdf_dir: Optional[str],
) -> list[SectionChunk]:
    source_url = record.source_url
    source_type = "official_pdf"

    try:
        pdf_bytes = _download_pdf(record.source_url)
    except Exception as url_exc:
        local_pdf = _find_local_pdf(record, local_pdf_dir)
        if not local_pdf:
            raise ValueError(
                f"Remote download failed ({url_exc}) and no local fallback found in {local_pdf_dir or '(none)'}"
            )
        with open(local_pdf, "rb") as file:
            pdf_bytes = file.read()
        source_url = local_pdf.replace("\\", "/")
        source_type = "local_pdf"
        print(f"[INFO]     -> Using local PDF fallback: {source_url}")

    pages = _extract_pdf_pages(pdf_bytes)
    if not any(page.strip() for page in pages):
        raise ValueError("PDF has no extractable text (possible scanned/image PDF).")

    section_blocks = _split_into_section_blocks(
        pages,
        min_chunk_chars=min_chunk_chars,
        max_chunk_chars=max_chunk_chars,
    )

    if not section_blocks:
        joined = " ".join(page for page in pages if page).strip()
        if joined:
            section_blocks = [(joined[:max_chunk_chars], None, "Overview", 1, max(1, len(pages)))]

    year_introduced, year_amendment, legal_status = _parse_years(record.coverage)

    output: list[SectionChunk] = []
    for index, (content, section_number, subsection_text, start_page, end_page) in enumerate(section_blocks, start=1):
        title = (subsection_text or f"{record.act_name} - Block {index}").strip()[:260]
        summary = re.split(r"(?<=[\.!?])\s+", content)
        summary_text = " ".join(summary[:2]).strip()[:900] if summary else content[:900]

        chunk_fingerprint = hashlib.sha256(
            f"{record.act_name}|{section_number or ''}|{start_page}|{end_page}|{content[:500]}".encode("utf-8")
        ).hexdigest()[:24]

        output.append(
            SectionChunk(
                chunk_id=f"{record.act_name[:36]}::{chunk_fingerprint}",
                act_name=record.act_name,
                category=record.category,
                authority=record.authority,
                document_name=record.act_name,
                title=title,
                content=content,
                section_number=section_number,
                subsection_text=subsection_text,
                start_page=start_page,
                end_page=end_page,
                year_introduced=year_introduced,
                year_amendment=year_amendment,
                legal_status=legal_status,
                related_acts=related_acts,
                keywords=_extract_keywords(content, title),
                punishments=_extract_punishments(content),
                source_url=source_url,
                source_type=source_type,
            )
        )

    return output


def _embed_chunks(chunks: list[SectionChunk], embed_url: str = "", timeout: int = 60) -> dict[str, list[float]]:
    """Embed section chunks. Empty embed_url uses admin ``ai_embeddings`` (same as chat/clash/search)."""
    if not embed_url:
        from backend.services.text_embeddings import embed_texts

        texts = [chunk.content for chunk in chunks]
        vecs = embed_texts(texts, task_type="RETRIEVAL_DOCUMENT")
        if len(vecs) != len(chunks):
            raise ValueError(f"Embedding count mismatch: {len(vecs)} != {len(chunks)}")
        return {chunk.chunk_id: vec for chunk, vec in zip(chunks, vecs)}

    payload = {
        "chunks": [
            {
                "id": chunk.chunk_id,
                "text": chunk.content,
                "metadata": {
                    "act_name": chunk.act_name,
                    "section_number": chunk.section_number,
                    "title": chunk.title,
                },
            }
            for chunk in chunks
        ],
        "normalize": True,
    }

    response = requests.post(
        embed_url,
        headers={"Content-Type": "application/json; charset=utf-8"},
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        timeout=timeout,
    )
    response.raise_for_status()
    items = response.json()

    if not isinstance(items, list):
        raise ValueError("Embedding API returned non-list response for /embed.")

    vectors: dict[str, list[float]] = {}
    for item in items:
        chunk_id = _safe_text(item.get("id"))
        embedding = item.get("embedding")
        if not chunk_id or not isinstance(embedding, list):
            continue
        if len(embedding) != EMBED_DIM:
            raise ValueError(f"Embedding dim mismatch for {chunk_id}: {len(embedding)} != {EMBED_DIM}")
        vectors[chunk_id] = [float(v) for v in embedding]

    return vectors


def _to_row(chunk: SectionChunk, embedding: list[float], created_by: str) -> dict[str, Any]:
    summary = re.split(r"(?<=[\.!?])\s+", chunk.content)
    summary_text = " ".join(summary[:2]).strip()[:900] if summary else chunk.content[:900]
    applicable_sections = [chunk.section_number] if chunk.section_number else None

    return {
        "document_name": chunk.document_name,
        "act_name": chunk.act_name,
        "category": chunk.category,
        "year_introduced": chunk.year_introduced,
        "year_amendment": chunk.year_amendment,
        "section_number": chunk.section_number,
        "subsection_text": chunk.subsection_text,
        "title": chunk.title,
        "content": chunk.content,
        "summary": summary_text,
        "authority": chunk.authority,
        "jurisdiction": "India",
        "legal_status": chunk.legal_status,
        "related_acts": chunk.related_acts or None,
        "keywords": chunk.keywords or None,
        "severity_level": None,
        "applicable_sections": applicable_sections,
        "punishments": chunk.punishments,
        "source_url": chunk.source_url,
        "source_type": chunk.source_type,
        "pdf_page_reference": f"p.{chunk.start_page}-{chunk.end_page}",
        "version": "1.0",
        "embedding": _to_pgvector(embedding),
        "language": "en",
        "created_by": created_by,
        "notes": None,
    }


def _chunked(items: Iterable[Any], batch_size: int) -> Iterable[list[Any]]:
    batch: list[Any] = []
    for item in items:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def _init_supabase_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set.")
    options = ClientOptions(headers={"Accept-Charset": "utf-8", "Content-Type": "application/json; charset=utf-8"})
    return create_client(url, key, options=options)


def ingest(
    csv_path: str,
    embed_url: str,
    min_chunk_chars: int,
    max_chunk_chars: int,
    embed_batch: int,
    insert_batch: int,
    dry_run: bool,
    replace_existing_act: bool,
    created_by: str,
    local_pdf_dir: Optional[str],
) -> None:
    print(f"[INFO] Reading CSV: {csv_path}")
    records = _read_law_csv(csv_path)
    if not records:
        raise ValueError("No valid records found in CSV.")

    print(f"[INFO] Loaded {len(records)} act records.")
    related_lookup = _derive_related_acts(records)

    all_chunks: list[SectionChunk] = []
    failures: list[tuple[str, str]] = []

    for index, record in enumerate(records, start=1):
        try:
            print(f"[INFO] ({index}/{len(records)}) Extracting: {record.act_name}")
            chunks = _build_chunks_for_record(
                record,
                related_acts=related_lookup.get(record.act_name, []),
                min_chunk_chars=min_chunk_chars,
                max_chunk_chars=max_chunk_chars,
                local_pdf_dir=local_pdf_dir,
            )
            all_chunks.extend(chunks)
            print(f"[INFO]     -> {len(chunks)} chunks")
        except Exception as exc:
            failures.append((record.act_name, str(exc)))
            print(f"[WARN] Failed {record.act_name}: {exc}")

    print(f"[INFO] Total chunks prepared: {len(all_chunks)}")

    if dry_run:
        print("[DRY-RUN] Skipping embedding and DB insert.")
        if failures:
            print("[DRY-RUN] Failures:")
            for act_name, err in failures:
                print(f"  - {act_name}: {err}")
        return

    supabase = _init_supabase_client()

    if replace_existing_act:
        distinct_acts = sorted(set(chunk.act_name for chunk in all_chunks))
        for act_name in distinct_acts:
            print(f"[INFO] Clearing old chunks for: {act_name}")
            supabase.table("legal_documents").delete().eq("act_name", act_name).execute()

    rows_to_insert: list[dict[str, Any]] = []
    for embed_group in _chunked(all_chunks, embed_batch):
        vectors = _embed_chunks(embed_group, embed_url=embed_url)
        for chunk in embed_group:
            vec = vectors.get(chunk.chunk_id)
            if not vec:
                continue
            rows_to_insert.append(_to_row(chunk, vec, created_by=created_by))

    print(f"[INFO] Rows ready for insert: {len(rows_to_insert)}")

    inserted = 0
    for row_batch in _chunked(rows_to_insert, insert_batch):
        supabase.table("legal_documents").insert(row_batch).execute()
        inserted += len(row_batch)
        print(f"[INFO] Inserted {inserted}/{len(rows_to_insert)}")

    print("[DONE] Ingestion completed.")
    if failures:
        print("[DONE] Partial failures:")
        for act_name, err in failures:
            print(f"  - {act_name}: {err}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest legal PDFs into Supabase legal_documents with semantic chunks.")
    parser.add_argument("--csv", default="assets/Untitled.csv", help="Path to input CSV")
    parser.add_argument(
        "--embed-url",
        default="",
        help="Optional /embed URL override. Empty = admin ai_embeddings (chat/clash/article search).",
    )
    parser.add_argument("--min-chars", type=int, default=900)
    parser.add_argument("--max-chars", type=int, default=2600)
    parser.add_argument("--embed-batch", type=int, default=18)
    parser.add_argument("--insert-batch", type=int, default=50)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--local-pdf-dir", default="assets", help="Local directory for PDF fallback if URL fails")
    parser.add_argument("--replace-existing-act", dest="replace_existing_act", action="store_true")
    parser.add_argument("--no-replace-existing-act", dest="replace_existing_act", action="store_false")
    parser.set_defaults(replace_existing_act=True)
    parser.add_argument("--created-by", default="script:ingest_legal_documents")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ingest(
        csv_path=args.csv,
        embed_url=args.embed_url,
        min_chunk_chars=args.min_chars,
        max_chunk_chars=args.max_chars,
        embed_batch=args.embed_batch,
        insert_batch=args.insert_batch,
        dry_run=args.dry_run,
        replace_existing_act=args.replace_existing_act,
        created_by=args.created_by,
        local_pdf_dir=args.local_pdf_dir,
    )


if __name__ == "__main__":
    main()
