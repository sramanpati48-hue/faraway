"""Cluster similar user cases and register confirmed scam trends into mock_scams.

Admin / schedule enqueue rows into ``scam_classifier_runs`` (status=queued).
A dedicated process — ``python -m backend.workers.scam_classifier_worker`` —
claims and processes them (and owns the 2×/day schedule) so FastAPI reload
cannot kill clustering work.

Set ``SCAM_CLASSIFIER_INLINE_WORKER=1`` for in-process threads (dev only).
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured
from backend.services import admin_models
from backend.services import embedding_admin
from backend.utils import get_llm_for_task

logger = logging.getLogger(__name__)

_RUNS: dict[str, dict[str, Any]] = {}
_RUNS_LOCK = threading.Lock()
_PROCESSING: set[str] = set()
_PROCESSING_LOCK = threading.Lock()


def _inline_worker_enabled() -> bool:
    """Default ON so jobs never sit queued forever. Set =0 to use only a dedicated worker."""
    flag = (os.getenv("SCAM_CLASSIFIER_INLINE_WORKER") or "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _on_cloud_run() -> bool:
    """Cloud Run freezes background threads after the request (CPU throttling)."""
    return bool(os.getenv("K_SERVICE") or os.getenv("CLOUD_RUN_SERVICE_URL"))

_DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": True,
    "interval_hours": 12,
    "similarity_threshold": 0.82,
    "min_same_case_count": 5,
    "lookback_days": 30,
    "last_run_at": None,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _sanitize(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {}
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, (datetime, date)):
            out[k] = v.isoformat()
        elif k == "embedding":
            out.pop(k, None)
    return out


def get_config() -> dict[str, Any]:
    cfg = admin_models.read_config_key("scam_classifier", dict(_DEFAULT_CONFIG))
    merged = {**_DEFAULT_CONFIG, **(cfg or {})}
    return merged


def _update_last_run_at() -> None:
    cfg = get_config()
    cfg["last_run_at"] = _utcnow().isoformat()
    try:
        admin_models.write_config_key("scam_classifier", cfg)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist scam_classifier.last_run_at: %s", exc)


def _update_run(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    cols = []
    vals: list[Any] = []
    for key, value in fields.items():
        cols.append(f"{key} = %s")
        if key == "config" and not isinstance(value, str):
            vals.append(json.dumps(value, default=str))
        else:
            vals.append(value)
    cols.append("updated_at = now()")
    vals.append(run_id)
    if is_postgres_configured():
        try:
            execute_void(
                f"UPDATE public.scam_classifier_runs SET {', '.join(cols)} WHERE id = %s",
                tuple(vals),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ scam_classifier_runs update failed: {exc}")
    with _RUNS_LOCK:
        live = _RUNS.get(run_id)
        if live:
            live.update(fields)
            live["updated_at"] = _utcnow().isoformat()


def get_run(run_id: str) -> Optional[dict[str, Any]]:
    if is_postgres_configured():
        row = execute_one("SELECT * FROM public.scam_classifier_runs WHERE id = %s", (run_id,))
        if row:
            sanitized = _sanitize(row)
            with _RUNS_LOCK:
                _RUNS[run_id] = sanitized
            return sanitized
    with _RUNS_LOCK:
        live = _RUNS.get(run_id)
        if live:
            return dict(live)
    return None


def list_runs(limit: int = 30) -> list[dict[str, Any]]:
    if not is_postgres_configured():
        with _RUNS_LOCK:
            rows = sorted(_RUNS.values(), key=lambda r: r.get("created_at") or "", reverse=True)
            return [dict(r) for r in rows[:limit]]
    rows = execute(
        "SELECT * FROM public.scam_classifier_runs ORDER BY created_at DESC LIMIT %s",
        (limit,),
    )
    return [_sanitize(r) for r in rows]


def start_run(*, trigger_source: str = "manual", created_by: str | None = None) -> dict[str, Any]:
    cfg = get_config()
    run_id = str(uuid.uuid4())
    message = "Starting…"
    run = {
        "id": run_id,
        "created_at": _utcnow().isoformat(),
        "updated_at": _utcnow().isoformat(),
        "created_by": created_by,
        "trigger_source": trigger_source,
        "status": "queued",
        "progress": 0,
        "cases_scanned": 0,
        "clusters_found": 0,
        "clusters_registered": 0,
        "message": message,
        "error": None,
        "config": cfg,
    }
    if is_postgres_configured():
        execute_void(
            """
            INSERT INTO public.scam_classifier_runs (
              id, created_by, trigger_source, status, progress, message, config
            ) VALUES (%s, %s, %s, 'queued', 0, %s, %s::jsonb)
            """,
            (run_id, created_by, trigger_source, message, json.dumps(cfg, default=str)),
        )
    with _RUNS_LOCK:
        _RUNS[run_id] = run
    # Local/dev: start a daemon thread. On Cloud Run, leave queued — the admin UI
    # (or POST .../process) runs the job inside an HTTP request so CPU stays allocated
    # without min-instances / always-on CPU.
    if _inline_worker_enabled() and not _on_cloud_run():
        ensure_processing(run_id, sync=False)
    else:
        _update_run(
            run_id,
            message=(
                "Queued — waiting for process request"
                if _on_cloud_run()
                else "Queued — waiting for dedicated worker"
            ),
        )
    return get_run(run_id) or dict(run)


def claim_next_queued_run(worker_id: str) -> Optional[dict[str, Any]]:
    """Atomically claim the oldest queued clustering job."""
    if not is_postgres_configured():
        return None
    message = f"Claimed by worker {worker_id}"
    try:
        row = execute_one(
            """
            WITH next_job AS (
              SELECT id
              FROM public.scam_classifier_runs
              WHERE status = 'queued'
              ORDER BY created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE public.scam_classifier_runs AS r
            SET status = 'running',
                progress = 2,
                message = %s,
                error = NULL,
                updated_at = now()
            FROM next_job
            WHERE r.id = next_job.id
            RETURNING r.*
            """,
            (message,),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ scam_classifier claim failed: {exc}")
        return None
    if not row:
        return None
    sanitized = _sanitize(row)
    with _RUNS_LOCK:
        _RUNS[str(sanitized["id"])] = sanitized
    return sanitized


def maybe_enqueue_scheduled_run() -> Optional[dict[str, Any]]:
    """If due by interval_hours / last_run_at, enqueue one scheduled job (idempotent)."""
    cfg = get_config()
    if not cfg.get("enabled", True):
        return None
    # Don't pile up if a job is already waiting or running
    if is_postgres_configured():
        busy = execute_one(
            """
            SELECT id FROM public.scam_classifier_runs
            WHERE status IN ('queued', 'running')
            ORDER BY created_at DESC
            LIMIT 1
            """
        )
        if busy:
            return None
    interval_hours = float(cfg.get("interval_hours") or 12)
    interval_sec = max(300.0, interval_hours * 3600.0)
    last = cfg.get("last_run_at")
    if last:
        try:
            last_ts = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
            if (_utcnow() - last_ts).total_seconds() < interval_sec:
                return None
        except Exception:
            pass
    return start_run(trigger_source="schedule", created_by="system")


def _case_description(row: dict[str, Any]) -> str:
    report = row.get("structured_report") or {}
    if isinstance(report, str):
        try:
            report = json.loads(report)
        except Exception:
            report = {}
    summary = str((report or {}).get("summary") or "").strip()
    verbatim = str((report or {}).get("user_verbatim") or "").strip()
    incident = str((report or {}).get("incident_type") or "").strip()
    similarity = str((report or {}).get("scam_similarity") or "").strip()
    match_titles = []
    for item in (report or {}).get("matched_scam_trends") or []:
        if isinstance(item, dict) and item.get("title"):
            match_titles.append(str(item["title"]))
    parts = [p for p in [incident, summary, verbatim, similarity] if p]
    if match_titles:
        parts.append("Matched trends: " + "; ".join(match_titles[:4]))
    text = " | ".join(parts)
    return text[:800]


def _parse_embedding(raw: Any) -> list[float]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        s = raw.strip().strip("[]")
        if not s:
            return []
        try:
            return [float(x) for x in s.split(",")]
        except Exception:
            return []
    return []


def _llm_same_scam(descriptions: list[str]) -> bool:
    """Ask classifier LLM whether these descriptions are the same scam pattern."""
    if len(descriptions) < 2:
        return False
    numbered = "\n".join(f"{i+1}. {d[:400]}" for i, d in enumerate(descriptions[:12]))
    system = SystemMessage(
        content=(
            "You classify whether user-reported scam/fraud case descriptions refer to "
            "the SAME scam pattern (same modus operandi). Reply with ONLY JSON: "
            '{"same_scam": true|false, "reason": "..."}. '
            "Be strict: similar theme is not enough if MO differs."
        )
    )
    human = HumanMessage(content=f"Case descriptions:\n{numbered}")
    try:
        llm = get_llm_for_task("scam_classifier.classifier")
        resp = llm.invoke([system, human])
        content = getattr(resp, "content", "") or ""
        if isinstance(content, list):
            content = " ".join(str(p.get("text") if isinstance(p, dict) else p) for p in content)
        text = str(content).strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence:
            text = fence.group(1).strip()
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return False
        data = json.loads(text[start : end + 1])
        return bool(data.get("same_scam"))
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ scam classifier LLM failed: {exc}")
        return False


def _register_cluster(members: list[dict[str, Any]], cluster_id: str) -> bool:
    from backend.database import supabase_db

    descs = [_case_description(m) for m in members]
    # Pick most common city if present
    cities: list[str] = []
    incidents: list[str] = []
    for m in members:
        report = m.get("structured_report") or {}
        if isinstance(report, str):
            try:
                report = json.loads(report)
            except Exception:
                report = {}
        loc = (report or {}).get("location") or {}
        if isinstance(loc, dict) and loc.get("city"):
            cities.append(str(loc["city"]))
        if (report or {}).get("incident_type"):
            incidents.append(str(report["incident_type"]))
    city = max(set(cities), key=cities.count) if cities else "India"
    scam_type = max(set(incidents), key=incidents.count) if incidents else "Scam/Fraud"
    title = f"{scam_type} trend cluster ({len(members)} cases) — {city}"
    description = (
        f"Auto-detected recurring scam from {len(members)} similar user cases. "
        f"Representative reports: " + " || ".join(d[:220] for d in descs[:5])
    )
    emb = None
    try:
        vecs = embedding_admin._embed_texts([f"{title}. {description}"[:4000]])
        emb = vecs[0] if vecs else None
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ cluster embed failed: {exc}")

    ok = supabase_db.insert_mock_scam_with_embedding(
        title=title[:200],
        description=description[:2000],
        scam_type=scam_type[:120],
        risk_level="High",
        city=city[:120],
        lat=None,
        lon=None,
        embedding=emb,
    )
    if not ok:
        return False
    ids = [str(m["id"]) for m in members if m.get("id")]
    if ids and is_postgres_configured():
        execute_void(
            """
            UPDATE public.cases
            SET scam_cluster_id = %s, clustered_at = now(), updated_at = now()
            WHERE id = ANY(%s)
            """,
            (cluster_id, list(ids)),
        )
    return True


def claim_run(run_id: str) -> bool:
    """Atomically move a specific run from queued → running. True if we claimed it."""
    if is_postgres_configured():
        try:
            row = execute_one(
                """
                UPDATE public.scam_classifier_runs
                SET status = 'running',
                    progress = 2,
                    message = 'Starting…',
                    error = NULL,
                    updated_at = now()
                WHERE id = %s AND status = 'queued'
                RETURNING id
                """,
                (run_id,),
            )
            return bool(row)
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ scam_classifier claim_run failed: {exc}")
            return False
    with _RUNS_LOCK:
        live = _RUNS.get(run_id)
        if not live or live.get("status") != "queued":
            return False
        live["status"] = "running"
        live["progress"] = 2
        live["message"] = "Starting…"
        live["updated_at"] = _utcnow().isoformat()
        return True


def ensure_processing(run_id: str, *, sync: bool = False) -> Optional[dict[str, Any]]:
    """Start a queued run. ``sync=True`` runs in-request (Cloud Run process endpoint)."""
    run = get_run(run_id)
    if not run:
        return None
    if run.get("status") in ("completed", "failed"):
        return run

    status = run.get("status")
    with _PROCESSING_LOCK:
        if run_id in _PROCESSING:
            return run
        if status == "queued":
            if not _inline_worker_enabled() and not sync:
                _update_run(run_id, message="Queued — waiting for dedicated worker")
                return get_run(run_id)
            if _on_cloud_run() and not sync:
                return run
            if not claim_run(run_id):
                return get_run(run_id)
            _PROCESSING.add(run_id)
        else:
            # running / other — another request or instance owns it
            return run

    def _work() -> None:
        try:
            process_run(run_id)
        finally:
            with _PROCESSING_LOCK:
                _PROCESSING.discard(run_id)

    if sync:
        _work()
    else:
        threading.Thread(target=_work, name=f"scam-classifier-{run_id[:8]}", daemon=True).start()
    return get_run(run_id)


def tick_schedule_and_process(*, sync: bool = False) -> Optional[dict[str, Any]]:
    """Enqueue a scheduled run if due, then ensure any queued run starts."""
    scheduled = maybe_enqueue_scheduled_run()
    # Prefer the just-enqueued job; otherwise drain oldest queued.
    if scheduled:
        return ensure_processing(str(scheduled["id"]), sync=sync)
    if is_postgres_configured():
        row = execute_one(
            """
            SELECT id FROM public.scam_classifier_runs
            WHERE status = 'queued'
            ORDER BY created_at ASC
            LIMIT 1
            """
        )
        if row:
            return ensure_processing(str(row["id"]), sync=sync)
    return scheduled


def process_run(run_id: str) -> None:
    """Execute one clustering job (dedicated worker or inline fallback)."""
    run = get_run(run_id)
    if not run:
        return
    if run.get("status") in ("completed", "failed"):
        return
    cfg = get_config()
    threshold = float(cfg.get("similarity_threshold") or 0.82)
    min_count = int(cfg.get("min_same_case_count") or 5)
    lookback = int(cfg.get("lookback_days") or 30)

    _update_run(run_id, status="running", progress=5, message="Loading recent embedded cases…", config=cfg)
    try:
        if not is_postgres_configured():
            raise RuntimeError("DATABASE_URL not configured")

        try:
            rows = execute(
                """
                SELECT id, structured_report, embedding::text AS embedding, timestamp
                FROM public.cases
                WHERE embedding IS NOT NULL
                  AND scam_cluster_id IS NULL
                  AND timestamp >= now() - (%s * INTERVAL '1 day')
                ORDER BY timestamp DESC
                LIMIT 400
                """,
                (lookback,),
            )
        except Exception as qexc:  # noqa: BLE001
            print(f"⚠️ case load with lookback failed, falling back: {qexc}")
            rows = execute(
                """
                SELECT id, structured_report, embedding::text AS embedding, timestamp
                FROM public.cases
                WHERE embedding IS NOT NULL
                  AND scam_cluster_id IS NULL
                ORDER BY timestamp DESC
                LIMIT 400
                """
            )
        rows = rows or []

        cases_scanned = len(rows or [])
        _update_run(run_id, cases_scanned=cases_scanned, progress=15, message=f"Scanning {cases_scanned} cases…")

        visited: set[str] = set()
        clusters_found = 0
        clusters_registered = 0

        for idx, seed in enumerate(rows or []):
            seed_id = str(seed.get("id") or "")
            if not seed_id or seed_id in visited:
                continue
            emb = _parse_embedding(seed.get("embedding"))
            if not emb:
                continue

            neighbors = execute(
                """
                SELECT case_row, similarity
                FROM public.match_cases(%s::vector, %s, %s, %s)
                """,
                (
                    embedding_admin.format_pgvector(emb),
                    max(min_count + 5, 15),
                    seed_id,
                    threshold,
                ),
            )
            member_rows: list[dict[str, Any]] = [seed]
            for n in neighbors or []:
                crow = n.get("case_row") or {}
                if isinstance(crow, str):
                    try:
                        crow = json.loads(crow)
                    except Exception:
                        crow = {}
                cid = str((crow or {}).get("id") or "")
                if not cid or cid in visited:
                    continue
                # Skip already clustered
                if (crow or {}).get("scam_cluster_id"):
                    continue
                member_rows.append(crow)

            if len(member_rows) < min_count:
                visited.add(seed_id)
                continue

            clusters_found += 1
            descs = [_case_description(m) for m in member_rows]
            # Filter out empty / non-scam-ish
            scamish = [
                d
                for d in descs
                if any(k in d.lower() for k in ("scam", "fraud", "otp", "upi", "phish", "kyc", "cheat"))
            ]
            if len(scamish) < min_count:
                # Still ask LLM if enough members; use all descriptions
                scamish = descs

            _update_run(
                run_id,
                progress=min(90, 20 + int(70 * (idx + 1) / max(cases_scanned, 1))),
                clusters_found=clusters_found,
                message=f"Classifying cluster of {len(member_rows)} cases…",
            )

            if not _llm_same_scam(scamish[:12]):
                visited.add(seed_id)
                continue

            cluster_id = str(uuid.uuid4())
            if _register_cluster(member_rows, cluster_id):
                clusters_registered += 1
                for m in member_rows:
                    if m.get("id"):
                        visited.add(str(m["id"]))
            else:
                visited.add(seed_id)

            _update_run(
                run_id,
                clusters_found=clusters_found,
                clusters_registered=clusters_registered,
            )

        _update_last_run_at()
        _update_run(
            run_id,
            status="completed",
            progress=100,
            cases_scanned=cases_scanned,
            clusters_found=clusters_found,
            clusters_registered=clusters_registered,
            message=(
                f"Done — scanned {cases_scanned}, found {clusters_found} clusters, "
                f"registered {clusters_registered} into mock_scams"
            ),
            error=None,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("scam_case_classifier failed")
        _update_run(
            run_id,
            status="failed",
            progress=100,
            error=str(exc),
            message="Failed",
        )


class ScamClassifierScheduler:
    """Deprecated no-op — schedule lives in ``scam_classifier_worker``."""

    async def start(self):
        logger.info(
            "scam_classifier schedule is owned by "
            "`python -m backend.workers.scam_classifier_worker` (not FastAPI)"
        )

    async def stop(self):
        return None


scheduler = ScamClassifierScheduler()

# Backwards-compatible alias
_run_once = process_run


def embed_case_async(case_id: str, structured_report: dict | None = None) -> None:
    """Daemon-thread helper: embed a case summary into cases.embedding."""

    def _work():
        try:
            if not is_postgres_configured() or not case_id:
                return
            report = structured_report
            if report is None:
                row = execute_one(
                    "SELECT structured_report FROM public.cases WHERE id = %s",
                    (case_id,),
                )
                report = (row or {}).get("structured_report") or {}
            if isinstance(report, str):
                try:
                    report = json.loads(report)
                except Exception:
                    report = {}
            summary = str((report or {}).get("summary") or "").strip()
            verbatim = str((report or {}).get("user_verbatim") or "").strip()
            incident = str((report or {}).get("incident_type") or "").strip()
            text = ". ".join(p for p in [incident, summary, verbatim] if p)
            if not text or len(text) < 20:
                return
            vecs = embedding_admin._embed_texts([text[:4000]])
            if not vecs:
                return
            execute_void(
                """
                UPDATE public.cases
                SET embedding = %s::vector, embedded_at = now(), updated_at = now()
                WHERE id = %s
                """,
                (embedding_admin.format_pgvector(vecs[0]), case_id),
            )
            matches = (report or {}).get("matched_scam_trends") if isinstance(report, dict) else None
            note = str((report or {}).get("scam_similarity") or "") if isinstance(report, dict) else ""
            if matches:
                try:
                    from backend.database import supabase_db

                    if hasattr(supabase_db, "persist_case_scam_matches"):
                        supabase_db.persist_case_scam_matches(case_id, matches, note)
                except Exception as persist_err:  # noqa: BLE001
                    print(f"⚠️ persist matches after embed skipped: {persist_err}")
            print(f"✅ Case embedding stored for {case_id}")
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ Case embed failed ({case_id}): {exc}")

    threading.Thread(target=_work, daemon=True).start()
