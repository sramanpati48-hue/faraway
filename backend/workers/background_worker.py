"""Unified background worker — processes BOTH scam-trends and case-clustering jobs.

One process handles every queued background job so you never run more than one
worker:

    python -m backend.workers.background_worker

It:
  - fails hung scam_trend_runs (stale cleanup),
  - enqueues the scam_classifier schedule when due (interval_hours),
  - claims + processes queued scam_trend_runs AND scam_classifier_runs.

Preferred on Cloud Run (cheap, scale-to-zero): do NOT run this loop. Jobs are
executed via POST .../process inside an HTTP request the admin UI opens — no
min-instances and no always-on CPU.

Optional always-on mode (costs money): set RUN_BACKGROUND_WORKER=1 and deploy
with min-instances>=1 and --no-cpu-throttling, or run this module as its own
process / Cloud Run Job.

Env:
  DATABASE_URL                 required (Postgres)
  BACKGROUND_WORKER_POLL_SEC   idle poll interval (default 3)
  SCAM_TRENDS_STALE_SEC        fail hung trend jobs (default 300)
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time

_started = False
_start_lock = threading.Lock()


def _load_env() -> None:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except Exception:
        pass


def _run_loop(stop_event: threading.Event | None = None) -> int:
    from backend.database.postgres_pool import is_postgres_configured
    from backend.services import scam_case_classifier as classifier
    from backend.services import scam_trends_scraper as scraper

    if not is_postgres_configured():
        print("❌ DATABASE_URL / Postgres not configured — background worker cannot start")
        return 1

    poll_sec = max(1.0, float(os.getenv("BACKGROUND_WORKER_POLL_SEC") or "3"))
    stale_sec = max(60, int(os.getenv("SCAM_TRENDS_STALE_SEC") or "300"))
    worker_id = f"{socket.gethostname()}:{os.getpid()}"

    print(f"🛠️  Background worker started id={worker_id} poll={poll_sec}s")
    print("   Handles scam_trend_runs + scam_classifier_runs (schedule + Run-now).")

    while not (stop_event and stop_event.is_set()):
        did_work = False
        try:
            # 1) Housekeeping
            scraper._mark_stale_runs(max_age_sec=stale_sec)

            # 2) Scam classifier schedule (interval_hours) — enqueue if due
            try:
                scheduled = classifier.maybe_enqueue_scheduled_run()
                if scheduled:
                    print(f"📅 Enqueued scheduled classifier run {scheduled.get('id')}")
            except Exception as exc:  # noqa: BLE001
                print(f"⚠️ classifier schedule check failed: {exc}")

            # 3) Scam trends jobs
            trend_job = scraper.claim_next_queued_run(worker_id)
            if trend_job:
                run_id = str(trend_job["id"])
                print(f"▶️  Processing scam trend run {run_id}")
                scraper.process_run(run_id)
                done = scraper.get_run(run_id) or {}
                print(
                    f"✅ Trend run {run_id} → {done.get('status')} "
                    f"stored={done.get('stored_count')} searched={done.get('searched_count')}"
                )
                did_work = True

            # 4) Case clustering jobs
            cluster_job = classifier.claim_next_queued_run(worker_id)
            if cluster_job:
                run_id = str(cluster_job["id"])
                print(f"▶️  Processing classifier run {run_id} ({cluster_job.get('trigger_source')})")
                classifier.process_run(run_id)
                done = classifier.get_run(run_id) or {}
                print(
                    f"✅ Cluster run {run_id} → {done.get('status')} "
                    f"scanned={done.get('cases_scanned')} "
                    f"found={done.get('clusters_found')} "
                    f"registered={done.get('clusters_registered')}"
                )
                did_work = True
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ background worker loop error: {exc}")

        # Loop immediately if we processed a job (drain the queue), else idle-poll.
        if not did_work:
            if stop_event:
                stop_event.wait(poll_sec)
            else:
                time.sleep(poll_sec)
    return 0


def start_in_background() -> bool:
    """Start the worker loop in a daemon thread (for in-process Cloud Run use).

    Returns True if it started, False if it was already running or disabled.
    """
    global _started
    with _start_lock:
        if _started:
            return False
        from backend.database.postgres_pool import is_postgres_configured

        if not is_postgres_configured():
            print("ℹ️ background worker not started (Postgres not configured)")
            return False
        thread = threading.Thread(
            target=_run_loop,
            name="background-worker",
            daemon=True,
        )
        thread.start()
        _started = True
        print("🧵 Background worker running in-process (RUN_BACKGROUND_WORKER=1)")
        return True


def main() -> int:
    _load_env()
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        return _run_loop()
    except KeyboardInterrupt:
        print("🛑 Background worker stopped")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
