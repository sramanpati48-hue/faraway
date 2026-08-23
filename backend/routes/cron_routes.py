"""Unauthenticated-by-JWT cron endpoints secured with ``CRON_SECRET``.

UptimeRobot (or any HTTP monitor) should hit the tick URLs on a short interval.
Keeping the API awake via ``GET /ping`` does **not** run clustering — only
``/api/cron/scam-classifier/tick`` checks ``interval_hours`` / ``last_run_at``
and starts a job when due.
"""
from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from backend.services import scam_case_classifier
from backend.services import moderator_queue
from backend.services import clash_billing

router = APIRouter(prefix="/api/cron", tags=["cron"])

TICK_PATHS = frozenset(
    {
        "/api/cron/scam-classifier/tick",
        "/apis/api/cron/scam-classifier/tick",
    }
)
PING_PATHS = frozenset({"/health", "/api/health", "/ping", "/api/ping"})


def _require_cron_secret(x_cron_secret: str | None, secret_query: str | None = None) -> None:
    expected = (os.getenv("CRON_SECRET") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET not configured on this service")
    provided = (x_cron_secret or secret_query or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid cron secret")


def run_classifier_tick(x_cron_secret: str | None, secret_query: str | None) -> dict:
    """Enqueue/start clustering if due. Always returns quickly (job is backgrounded)."""
    _require_cron_secret(x_cron_secret, secret_query)
    cfg = scam_case_classifier.get_config()
    run = scam_case_classifier.tick_schedule_and_process(sync=False)
    return {
        "success": True,
        "triggered": bool(run),
        "run": run,
        "config": {
            "enabled": cfg.get("enabled", True),
            "interval_hours": cfg.get("interval_hours"),
            "last_run_at": cfg.get("last_run_at"),
        },
    }


def classifier_tick_http_response(
    method: str,
    x_cron_secret: str | None,
    secret_query: str | None,
) -> Response:
    payload = run_classifier_tick(x_cron_secret, secret_query)
    if method.upper() == "HEAD":
        return Response(status_code=200)
    return JSONResponse(payload)


@router.api_route("/scam-classifier/tick", methods=["HEAD", "GET", "POST"])
async def cron_scam_classifier_tick(
    request: Request,
    x_cron_secret: str | None = Header(default=None),
    secret: str | None = Query(default=None),
):
    """UptimeRobot free sends HEAD with ``?secret=``. POST + ``X-Cron-Secret`` also works."""
    try:
        return classifier_tick_http_response(request.method, x_cron_secret, secret)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/health")
async def cron_health(
    x_cron_secret: str | None = Header(default=None),
    secret: str | None = Query(default=None),
):
    _require_cron_secret(x_cron_secret, secret)
    return {"ok": True, "service": "cron"}


@router.post("/moderator-sla/tick")
async def cron_moderator_sla_tick(x_cron_secret: str | None = Header(default=None)):
    """Apply delay/respect ticks for overdue exclusive moderator assignments."""
    _require_cron_secret(x_cron_secret)
    try:
        result = moderator_queue.run_sla_delay_ticks()
        return {"success": True, **result, "config": moderator_queue.get_queue_config()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/clash-billing/reconcile")
async def cron_clash_billing_reconcile(x_cron_secret: str | None = Header(default=None)):
    """Ask Razorpay about pending Clash checkouts whose Checkout.js callback never ran."""
    _require_cron_secret(x_cron_secret)
    try:
        result = clash_billing.reconcile_pending_checkouts()
        return {"success": True, **result}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
