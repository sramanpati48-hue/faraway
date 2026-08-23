"""Admin Scam Trends scraper: web search → article fetch → LLM normalize → draft staging.

The requested areas only shape the search queries. Each trend's city, state, and
map coordinates come from the model reading the fetched article; geocoding is a
fallback, and the India centroid is used only when no place is named at all.
Set ``SCAM_TRENDS_FETCH_PAGES=0`` to skip article fetching (snippets only) and
``SCAM_TRENDS_PAGE_BUDGET_SEC`` to cap the per-area fetch wait.

Production path: API enqueues rows into ``scam_trend_runs`` (status=queued).
A dedicated process — ``python -m backend.workers.scam_trends_worker`` — claims
and processes jobs so uvicorn reload / other API work cannot kill the scrape.

Extracted trends land in ``scam_trend_drafts`` for admin approve → promote
into ``mock_scams``. Set ``SCAM_TRENDS_INLINE_WORKER=1`` for in-process threads
(dev fallback only).
"""
from __future__ import annotations

import json
import os
import random
import re
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from langchain_core.messages import HumanMessage, SystemMessage

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured
from backend.services import embedding_admin
from backend.utils import invoke_llm_with_selection

_RUNS: dict[str, dict[str, Any]] = {}
_RUNS_LOCK = threading.Lock()
_PROCESSING: set[str] = set()
_PROCESSING_LOCK = threading.Lock()
_DRAFTS: dict[str, list[dict[str, Any]]] = {}
_DRAFTS_LOCK = threading.Lock()

_SIMILARITY_FLAG = 0.90

# Article fetching is what lets the model geolocate a scam; cap the wait per area.
try:
    _PAGE_FETCH_BUDGET_SEC = float(os.getenv("SCAM_TRENDS_PAGE_BUDGET_SEC") or 20)
except ValueError:
    _PAGE_FETCH_BUDGET_SEC = 20.0

# Major Indian city centers for heatmap points (same idea as seed_scams.py).
_CITY_COORDS: dict[str, tuple[float, float]] = {
    "mumbai": (19.0760, 72.8777),
    "delhi": (28.7041, 77.1025),
    "new delhi": (28.6139, 77.2090),
    "bengaluru": (12.9716, 77.5946),
    "bangalore": (12.9716, 77.5946),
    "kolkata": (22.5726, 88.3639),
    "hyderabad": (17.3850, 78.4867),
    "chennai": (13.0827, 80.2707),
    "pune": (18.5204, 73.8567),
    "jaipur": (26.9124, 75.7873),
    "lucknow": (26.8467, 80.9462),
    "ahmedabad": (23.0225, 72.5714),
    "patna": (25.5941, 85.1376),
    "guwahati": (26.1445, 91.7362),
    "chandigarh": (30.7333, 76.7794),
    "indore": (22.7196, 75.8577),
    "bhopal": (23.2599, 77.4126),
    "nagpur": (21.1458, 79.0882),
    "surat": (21.1702, 72.8311),
    "kochi": (9.9312, 76.2673),
    "cochin": (9.9312, 76.2673),
    "thiruvananthapuram": (8.5241, 76.9366),
    "visakhapatnam": (17.6868, 83.2185),
    "bhubaneswar": (20.2961, 85.8245),
    "ranchi": (23.3441, 85.3096),
    "raipur": (21.2514, 81.6296),
    "dehradun": (30.3165, 78.0322),
    "shimla": (31.1048, 77.1734),
    "goa": (15.2993, 74.1240),
    "panaji": (15.4909, 73.8278),
    "varanasi": (25.3176, 82.9739),
    "kanpur": (26.4499, 80.3319),
    "noida": (28.5355, 77.3910),
    "gurgaon": (28.4595, 77.0266),
    "gurugram": (28.4595, 77.0266),
    "ghaziabad": (28.6692, 77.4538),
    "faridabad": (28.4089, 77.3178),
    "india": (22.9734, 78.6569),
}

_GEOCODE_CACHE: dict[str, tuple[Optional[float], Optional[float], str]] = {}
_GEOCODE_LOCK = threading.Lock()

# Editable from Admin → Scam trends → Edit system prompt (system_config key
# ``scam_trends``). The output schema below is NOT editable: the pipeline parses
# those exact keys.
DEFAULT_SYSTEM_PROMPT = """You extract REAL, RECENTLY REPORTED Indian cyber and financial scams from the news articles supplied to you.

INCLUDE a trend only when the article reports an actual incident or an official warning about a scam already in circulation. Acceptable evidence:
- police / cyber cell complaints, an FIR, a case count, or arrests
- named victims, a victim count, or money actually lost
- a dated advisory or alert from a named authority (I4C, CERT-In, RBI, SEBI, a state cyber police unit, a bank's fraud advisory, a telecom operator)
- a journalist reporting a wave of complaints with dates or numbers

REJECT and never return:
- hypothetical, illustrative or "what if" scenarios, and examples invented to explain how a fraud could work
- vendor, payment-gateway, antivirus, fintech or SaaS blog explainers and security marketing content
- evergreen awareness listicles ("top 10 scams to avoid", "how to stay safe online") with no incident behind them
- how-to-protect guides, product pages, ads, sponsored posts, and forum or social speculation
- anything you cannot ground in the article text, and any incident you cannot place in time

Prefer the most recent reports. Write each description as reporting of what happened — who was targeted, how the fraud ran, and the scale reported — not as generic advice.
Merge sources describing the same scheme into ONE trend with a single consolidated title and description; never emit near-duplicates.
Return fewer trends, or an empty list, rather than padding with material that fails these rules."""

# Field contract for the extractor. Kept in code so a prompt edit cannot break parsing.
EXTRACTION_SCHEMA: list[dict[str, str]] = [
    {"key": "title", "type": "string", "rule": "Short name of the scam pattern, as reported."},
    {
        "key": "description",
        "type": "string",
        "rule": "2-4 factual sentences grounded in the article: who was hit, how the fraud runs, reported scale. No invented laws or section numbers.",
    },
    {"key": "scam_type", "type": "string", "rule": "e.g. UPI Fraud, Phishing, Investment Fraud, Digital Arrest, Job Scam."},
    {"key": "risk_level", "type": "Low | Medium | High", "rule": "Severity for a typical victim."},
    {
        "key": "city",
        "type": "string | null",
        "rule": "Most specific Indian city/district the article ties the scam to (dateline, the cyber cell handling it, where victims were defrauded). null for a nationwide pattern.",
    },
    {"key": "state", "type": "string | null", "rule": "Indian state for that city, else null."},
    {
        "key": "lat",
        "type": "number | null",
        "rule": "Decimal degrees for that place. null whenever city is null — never guess for a nationwide trend, never outside India.",
    },
    {"key": "lon", "type": "number | null", "rule": "Decimal degrees, same rule as lat."},
    {
        "key": "location_basis",
        "type": "string | null",
        "rule": "Short quote from the article justifying the location, e.g. 'Pune cyber police registered 42 cases'.",
    },
    {
        "key": "reported_on",
        "type": "YYYY-MM-DD | null",
        "rule": "Date the incident or advisory was reported, from the article. null if the article carries no date.",
    },
    {
        "key": "evidence",
        "type": "string",
        "rule": "Short quote naming the real report behind the trend (complaint count, FIR, arrest, loss amount, or the authority that issued the alert). Required — omit the trend if you cannot supply it.",
    },
    {"key": "source_index", "type": "number", "rule": "The [n] of the source you drew the trend from."},
]

DEFAULT_BLOCKED_DOMAINS = [
    "razorpay.com",
    "cashfree.com",
    "payu.in",
    "norton.com",
    "kaspersky.com",
    "mcafee.com",
    "avast.com",
    "quickheal.com",
    "zoho.com",
    "freshworks.com",
    "signzy.com",
    "hyperverge.co",
    "idfy.com",
]

DEFAULT_TRENDS_CONFIG: dict[str, Any] = {
    "system_prompt": DEFAULT_SYSTEM_PROMPT,
    # Drop extracted trends reported longer ago than this (0 disables the check).
    "recency_days": 45,
    # DuckDuckGo recency window: d / w / m / y, or "" for no limit.
    "search_timelimit": "m",
    # Search the news index first — it surfaces reported incidents over explainers.
    "prefer_news": True,
    # Require the evidence quote and a usable report date before staging a trend.
    "strict_filters": True,
    "blocked_domains": DEFAULT_BLOCKED_DOMAINS,
}


def get_trends_config() -> dict[str, Any]:
    """Admin-editable extraction settings (system_config key ``scam_trends``)."""
    from backend.services import admin_models

    stored = admin_models.read_config_key("scam_trends", {})
    cfg = {**DEFAULT_TRENDS_CONFIG, **(stored if isinstance(stored, dict) else {})}
    if not str(cfg.get("system_prompt") or "").strip():
        cfg["system_prompt"] = DEFAULT_SYSTEM_PROMPT
    if not isinstance(cfg.get("blocked_domains"), list):
        cfg["blocked_domains"] = list(DEFAULT_BLOCKED_DOMAINS)
    try:
        cfg["recency_days"] = max(0, int(cfg.get("recency_days") or 0))
    except (TypeError, ValueError):
        cfg["recency_days"] = DEFAULT_TRENDS_CONFIG["recency_days"]
    if str(cfg.get("search_timelimit") or "") not in ("d", "w", "m", "y", ""):
        cfg["search_timelimit"] = DEFAULT_TRENDS_CONFIG["search_timelimit"]
    cfg["prefer_news"] = bool(cfg.get("prefer_news"))
    cfg["strict_filters"] = bool(cfg.get("strict_filters"))
    return cfg


def schema_hint() -> str:
    lines = [f"- {f['key']} ({f['type']}): {f['rule']}" for f in EXTRACTION_SCHEMA]
    return "\n".join(lines)


def _format_pgvector(values: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def _lookup_city_coords(name: str) -> Optional[tuple[float, float]]:
    key = re.sub(r"\s+", " ", (name or "").strip().lower())
    if not key:
        return None
    if key in _CITY_COORDS:
        return _CITY_COORDS[key]
    # Match if city name appears as a token (e.g. "South Delhi", "Mumbai suburban")
    for city, coords in _CITY_COORDS.items():
        if city == "india":
            continue
        if city in key or key in city:
            return coords
    return None


def _with_jitter(lat: float, lon: float, *, spread: float = 0.08) -> tuple[float, float]:
    """Small jitter so heatmap points don't stack on one pixel."""
    return (
        float(lat) + random.uniform(-spread, spread),
        float(lon) + random.uniform(-spread, spread),
    )


def resolve_scam_location(
    city: str,
    *,
    fallback_area: str = "India",
) -> tuple[str, Optional[float], Optional[float]]:
    """
    Resolve city/area text → (display_city, lat, lon) for mock_scams heatmap.
    Prefers a local city table; falls back to Nominatim forward geocode.
    """
    raw = (city or "").strip() or (fallback_area or "").strip() or "India"
    cache_key = raw.lower()
    with _GEOCODE_LOCK:
        cached = _GEOCODE_CACHE.get(cache_key)
    if cached:
        c_city, c_lat, c_lon = cached[2], cached[0], cached[1]
        if c_lat is not None and c_lon is not None:
            jlat, jlon = _with_jitter(c_lat, c_lon)
            return c_city or raw, jlat, jlon
        return c_city or raw, None, None

    display = raw
    coords = _lookup_city_coords(raw)
    if not coords and fallback_area and fallback_area.lower() != raw.lower():
        coords = _lookup_city_coords(fallback_area)
        if coords and (not raw or raw.lower() in ("india", "unknown", "nationwide")):
            display = fallback_area.strip() or display

    lat: Optional[float] = None
    lon: Optional[float] = None
    if coords:
        lat, lon = coords
    else:
        try:
            from backend.agents.common_utils import geocode_area_name

            geo = geocode_area_name(raw)
            if geo.get("lat") is not None and geo.get("lon") is not None:
                lat = float(geo["lat"])
                lon = float(geo["lon"])
                if geo.get("city") and str(geo["city"]).lower() not in ("unknown", ""):
                    display = str(geo["city"])
            else:
                # Last resort: India centroid so the point still appears on the map.
                lat, lon = _CITY_COORDS["india"]
                display = display if display.lower() not in ("", "unknown") else "India"
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ scam location geocode failed for {raw!r}: {exc}")
            lat, lon = _CITY_COORDS["india"]

    with _GEOCODE_LOCK:
        _GEOCODE_CACHE[cache_key] = (lat, lon, display)

    if lat is not None and lon is not None:
        jlat, jlon = _with_jitter(lat, lon)
        return display, jlat, jlon
    return display, None, None


def finalize_trend_location(item: dict[str, Any]) -> tuple[str, Optional[float], Optional[float], str]:
    """Pick the map location for an extracted trend.

    The model's own reading of the article wins; geocoding is only a fallback,
    and the India centroid only when the article names no place at all.
    Returns (display_city, lat, lon, source).
    """
    city = str(item.get("city") or "").strip()
    state = str(item.get("state") or "").strip()
    lat = _as_coord(item.get("lat"), lo=6.0, hi=37.5)
    lon = _as_coord(item.get("lon"), lo=68.0, hi=97.5)

    if lat is not None and lon is not None:
        known = _lookup_city_coords(city) if city else None
        if known and (abs(known[0] - lat) > 3.0 or abs(known[1] - lon) > 3.0):
            # Coordinates contradict the city the model named — trust the city.
            jlat, jlon = _with_jitter(known[0], known[1])
            return city, jlat, jlon, "geocoded"
        jlat, jlon = _with_jitter(lat, lon, spread=0.02)
        return (city or state or "India"), jlat, jlon, "model"

    place = city or state
    if place:
        display, glat, glon = resolve_scam_location(place, fallback_area=place)
        return display, glat, glon, "geocoded"

    ilat, ilon = _with_jitter(*_CITY_COORDS["india"], spread=1.5)
    return "India", ilat, ilon, "nationwide"


def _inline_worker_enabled() -> bool:
    """Default ON so jobs never sit queued forever. Set =0 to use only a dedicated worker."""
    flag = (os.getenv("SCAM_TRENDS_INLINE_WORKER") or "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _on_cloud_run() -> bool:
    """Cloud Run freezes background threads after the request (CPU throttling)."""
    return bool(os.getenv("K_SERVICE") or os.getenv("CLOUD_RUN_SERVICE_URL"))

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _sanitize(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {}
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, (datetime, date)):
            out[k] = v.isoformat()
    return out


def _update_run(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    cols = []
    vals: list[Any] = []
    for key, value in fields.items():
        cols.append(f"{key} = %s")
        if key in ("areas", "config") and not isinstance(value, str):
            vals.append(json.dumps(value, default=str))
        else:
            vals.append(value)
    cols.append("updated_at = now()")
    vals.append(run_id)
    if is_postgres_configured():
        try:
            execute_void(
                f"UPDATE public.scam_trend_runs SET {', '.join(cols)} WHERE id = %s",
                tuple(vals),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ scam_trend_runs update failed: {exc}")
    with _RUNS_LOCK:
        live = _RUNS.get(run_id)
        if live:
            live.update(fields)
            live["updated_at"] = _utcnow().isoformat()


def get_run(run_id: str) -> Optional[dict[str, Any]]:
    _requeue_orphaned_runs(max_age_sec=45)
    _mark_stale_runs()
    # Prefer Postgres so the API process sees progress from the dedicated worker.
    if is_postgres_configured():
        row = execute_one("SELECT * FROM public.scam_trend_runs WHERE id = %s", (run_id,))
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


def list_runs(limit: int = 50) -> list[dict[str, Any]]:
    _mark_stale_runs()
    if not is_postgres_configured():
        with _RUNS_LOCK:
            rows = sorted(_RUNS.values(), key=lambda r: r.get("created_at") or "", reverse=True)
            return [dict(r) for r in rows[:limit]]
    rows = execute(
        "SELECT * FROM public.scam_trend_runs ORDER BY created_at DESC LIMIT %s",
        (limit,),
    )
    return [_sanitize(r) for r in rows]


def create_run(
    *,
    target_date: str | date | None = None,
    areas: list[str] | None = None,
    count: int = 10,
    provider: str = "groq",
    model: str = "",
    custom_query: str | None = None,
    created_by: str | None = None,
) -> dict[str, Any]:
    if isinstance(target_date, str) and target_date.strip():
        try:
            td = date.fromisoformat(target_date.strip()[:10])
        except ValueError as exc:
            raise ValueError(f"Invalid date: {target_date}") from exc
    elif isinstance(target_date, date):
        td = target_date
    else:
        td = date.today()

    area_list = [a.strip() for a in (areas or ["India"]) if a and str(a).strip()]
    if not area_list:
        area_list = ["India"]
    requested = max(1, min(int(count or 10), 50))
    custom_q = (custom_query or "").strip()[:240]

    run_id = str(uuid.uuid4())
    cfg = {"provider": provider, "model": model, "custom_query": custom_q}
    run = {
        "id": run_id,
        "created_at": _utcnow().isoformat(),
        "updated_at": _utcnow().isoformat(),
        "created_by": created_by,
        "target_date": td.isoformat(),
        "areas": area_list,
        "requested_count": requested,
        "stored_count": 0,
        "extracted_count": 0,
        "approved_count": 0,
        "promoted_count": 0,
        "searched_count": 0,
        "provider": provider,
        "model": model,
        "custom_query": custom_q,
        "status": "queued",
        "progress": 0,
        "message": "Starting…",
        "error": None,
        "config": cfg,
    }

    if is_postgres_configured():
        execute_void(
            """
            INSERT INTO public.scam_trend_runs (
              id, created_by, target_date, areas, requested_count, provider, model, status, progress, message, config
            ) VALUES (%s, %s, %s::date, %s::jsonb, %s, %s, %s, 'queued', 0, %s, %s::jsonb)
            """,
            (
                run_id,
                created_by,
                td.isoformat(),
                json.dumps(area_list),
                requested,
                provider,
                model,
                run["message"],
                json.dumps(cfg),
            ),
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
    """Atomically claim the oldest queued job for a dedicated worker process."""
    if not is_postgres_configured():
        return None
    message = f"Claimed by worker {worker_id}"
    try:
        row = execute_one(
            """
            WITH next_job AS (
              SELECT id
              FROM public.scam_trend_runs
              WHERE status = 'queued'
              ORDER BY created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE public.scam_trend_runs AS r
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
        print(f"⚠️ claim_next_queued_run failed: {exc}")
        return None
    if not row:
        return None
    sanitized = _sanitize(row)
    with _RUNS_LOCK:
        _RUNS[str(sanitized["id"])] = sanitized
    return sanitized


def _import_ddgs():
    # Package renamed: prefer ``ddgs`` (new). Fall back to legacy duckduckgo_search.
    try:
        from ddgs import DDGS  # type: ignore

        return DDGS
    except ImportError:
        try:
            from duckduckgo_search import DDGS  # type: ignore

            return DDGS
        except ImportError as exc:
            raise ImportError(
                "DuckDuckGo search package missing. Install with: pip install ddgs"
            ) from exc


def _search_web(
    query: str,
    max_results: int = 8,
    timeout_sec: float = 12.0,
    *,
    timelimit: str = "",
    news: bool = False,
) -> list[dict[str, str]]:
    """DuckDuckGo search with a hard timeout (DDGS can hang indefinitely).

    ``news=True`` queries the news index, which surfaces reported incidents
    instead of evergreen explainers, and carries a publish date per hit.
    """
    results: list[dict[str, str]] = []
    error_box: list[BaseException] = []

    def _do_search() -> None:
        try:
            DDGS = _import_ddgs()
            # Avoid context-manager exit hangs; instantiate and call text() directly.
            ddgs = DDGS()
            kwargs: dict[str, Any] = {"max_results": max_results}
            if timelimit:
                kwargs["timelimit"] = timelimit
            search = ddgs.news if news and hasattr(ddgs, "news") else ddgs.text
            try:
                hits = search(query, **kwargs) or []
            except TypeError:
                # Older ddgs builds reject timelimit — fall back to a plain search.
                hits = search(query, max_results=max_results) or []
            for item in hits:
                if not isinstance(item, dict):
                    continue
                results.append(
                    {
                        "title": str(item.get("title") or ""),
                        "href": str(item.get("href") or item.get("url") or item.get("link") or ""),
                        "body": str(item.get("body") or item.get("excerpt") or item.get("snippet") or ""),
                        "published": str(item.get("date") or item.get("published") or "")[:25],
                    }
                )
        except BaseException as exc:  # noqa: BLE001
            error_box.append(exc)

    worker = threading.Thread(target=_do_search, daemon=True)
    worker.start()
    worker.join(timeout=timeout_sec)
    if worker.is_alive():
        print(f"⚠️ DDGS search timed out after {timeout_sec}s for '{query}'")
        return results
    if error_box:
        print(f"⚠️ DDGS search failed for '{query}': {error_box[0]}")
        if isinstance(error_box[0], ImportError):
            raise error_box[0]
    return results


def _requeue_orphaned_runs(max_age_sec: int = 45) -> None:
    """Re-queue ``running`` jobs with no recent heartbeat.

    Common after ``uvicorn --reload`` kills the process mid-scrape: status stays
    ``running`` and the UI looks stuck. Live jobs keep ``updated_at`` fresh via
    progress heartbeats, so they are not re-queued.
    """
    if not is_postgres_configured():
        with _RUNS_LOCK:
            now = _utcnow()
            for run in _RUNS.values():
                rid = str(run.get("id") or "")
                with _PROCESSING_LOCK:
                    if rid in _PROCESSING:
                        continue
                if run.get("status") != "running":
                    continue
                updated = run.get("updated_at") or run.get("created_at")
                try:
                    ts = datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
                except Exception:
                    continue
                if (now - ts).total_seconds() > max_age_sec:
                    run["status"] = "queued"
                    run["message"] = "Re-queued after interrupt (reload/timeout) — retrying…"
                    run["error"] = None
                    run["progress"] = max(0, int(run.get("progress") or 0))
        return

    try:
        execute_void(
            """
            UPDATE public.scam_trend_runs
            SET status = 'queued',
                error = NULL,
                message = 'Re-queued after interrupt (reload/timeout) — retrying…',
                updated_at = now()
            WHERE status = 'running'
              AND updated_at < now() - (%s * interval '1 second')
            """,
            (int(max_age_sec),),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ orphan re-queue failed: {exc}")


def _mark_stale_runs(max_age_sec: int = 300) -> None:
    """Re-queue short orphans; fail only if stuck far too long."""
    _requeue_orphaned_runs(max_age_sec=min(45, max_age_sec))
    if not is_postgres_configured():
        with _RUNS_LOCK:
            now = _utcnow()
            for run in _RUNS.values():
                if run.get("status") != "running":
                    continue
                updated = run.get("updated_at") or run.get("created_at")
                try:
                    ts = datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
                except Exception:
                    continue
                if (now - ts).total_seconds() > max_age_sec:
                    run["status"] = "failed"
                    run["error"] = "Timed out / worker stopped (hung search)"
                    run["message"] = "Failed"
                    run["progress"] = 100
        return
    try:
        execute_void(
            """
            UPDATE public.scam_trend_runs
            SET status = 'failed',
                progress = 100,
                error = COALESCE(NULLIF(error, ''), 'Timed out / worker stopped (hung search)'),
                message = 'Failed',
                updated_at = now()
            WHERE status = 'running'
              AND updated_at < now() - (%s * interval '1 second')
            """,
            (int(max_age_sec),),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ stale scam_trend_runs cleanup failed: {exc}")


def _fetch_page_text(url: str, max_chars: int = 2500) -> str:
    if not url or not url.startswith("http"):
        return ""
    try:
        host = urlparse(url).netloc.lower()
        if any(bad in host for bad in ("facebook.com", "twitter.com", "x.com", "instagram.com")):
            return ""
        resp = requests.get(
            url,
            headers={"User-Agent": _USER_AGENT},
            timeout=(5, 8),
            allow_redirects=True,
        )
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "").lower()
        if "html" not in ctype and "text" not in ctype:
            return ""
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
            tag.decompose()
        text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
        return text[:max_chars]
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ page fetch failed ({url}): {exc}")
        return ""


def _pages_enabled() -> bool:
    flag = (os.getenv("SCAM_TRENDS_FETCH_PAGES") or "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _fetch_pages(snippets: list[dict[str, str]], *, budget_sec: float = 20.0) -> int:
    """Attach article text to snippets in parallel, under a hard time budget.

    Page text is what lets the model place a scam on the map, so it is worth the
    wait — but a single slow host must never stall the run.
    """
    if not _pages_enabled() or not snippets:
        return 0
    from concurrent.futures import ThreadPoolExecutor, wait

    deadline = time.monotonic() + max(5.0, budget_sec)
    fetched = 0
    pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scam-page")
    try:
        futures = {
            pool.submit(_fetch_page_text, str(s.get("href") or ""), 4000): s for s in snippets
        }
        wait(futures, timeout=max(1.0, deadline - time.monotonic()))
        for future, snippet in futures.items():
            if not future.done():
                continue
            try:
                text = future.result(timeout=0)
            except Exception:  # noqa: BLE001
                text = ""
            if text:
                snippet["page_text"] = text
                fetched += 1
    finally:
        # Never block on a slow host: outstanding requests die on their own timeout.
        pool.shutdown(wait=False, cancel_futures=True)
    return fetched


def _guess_place_from_text(text: str) -> str:
    """Best-effort city pick from raw text when the model gives no location."""
    low = re.sub(r"\s+", " ", (text or "").lower())
    if not low:
        return ""
    for city in _CITY_COORDS:
        if city == "india":
            continue
        if re.search(rf"\b{re.escape(city)}\b", low):
            return city.title()
    return ""


def _as_coord(value: Any, *, lo: float, hi: float) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num != num or num < lo or num > hi:  # NaN or out of range
        return None
    return num


def _recency_cutoff(target_date: str, days: int) -> str:
    try:
        base = date.fromisoformat(str(target_date)[:10])
    except ValueError:
        base = date.today()
    return (base - timedelta(days=max(0, days))).isoformat()


def _parse_report_date(value: Any) -> Optional[date]:
    raw = str(value or "").strip()[:10]
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _blocked_host(url: str, blocked: list[str]) -> bool:
    host = urlparse(url or "").netloc.lower()
    if not host:
        return False
    return any(dom and dom.lower() in host for dom in blocked)


def _filter_extracted(
    items: list[dict[str, Any]],
    *,
    target_date: str,
    cfg: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, int]:
    """Drop explainer-style and stale items. Returns (kept, dropped_unreal, dropped_stale)."""
    if not cfg.get("strict_filters"):
        return items, 0, 0
    recency_days = int(cfg.get("recency_days") or 0)
    cutoff = _parse_report_date(_recency_cutoff(target_date, recency_days)) if recency_days > 0 else None
    kept: list[dict[str, Any]] = []
    unreal = 0
    stale = 0
    for item in items:
        if not str(item.get("evidence") or "").strip():
            unreal += 1
            continue
        reported = _parse_report_date(item.get("reported_on"))
        if cutoff is not None and (reported is None or reported < cutoff):
            stale += 1
            continue
        kept.append(item)
    return kept, unreal, stale


def _normalize_trend_item(item: dict[str, Any]) -> dict[str, Any] | None:
    title = str(item.get("title") or item.get("name") or "").strip()
    desc = str(
        item.get("description")
        or item.get("summary")
        or item.get("details")
        or item.get("body")
        or ""
    ).strip()
    if not title:
        return None
    if not desc:
        desc = f"{title}. Reported online scam / fraud pattern."
    risk = str(item.get("risk_level") or item.get("risk") or "Medium").strip().title()
    if risk not in {"Low", "Medium", "High"}:
        risk = "Medium"
    scam_type = str(item.get("scam_type") or item.get("type") or item.get("category") or "Online Fraud").strip()

    # Location comes from the article the model read — never from the search area.
    city = str(item.get("city") or item.get("location") or "").strip()
    if city.lower() in ("", "unknown", "n/a", "none", "null", "nationwide", "pan-india"):
        city = ""
    state = str(item.get("state") or "").strip()
    if state.lower() in ("unknown", "n/a", "none", "null"):
        state = ""
    reported = _parse_report_date(item.get("reported_on"))
    return {
        "title": title[:200],
        "description": desc[:2000],
        "scam_type": scam_type[:120] or "Online Fraud",
        "risk_level": risk,
        "city": city[:120],
        "state": state[:120],
        # India bounding box — keeps hallucinated foreign coordinates out.
        "lat": _as_coord(item.get("lat") or item.get("latitude"), lo=6.0, hi=37.5),
        "lon": _as_coord(item.get("lon") or item.get("longitude"), lo=68.0, hi=97.5),
        "location_basis": str(item.get("location_basis") or item.get("location_evidence") or "").strip()[:300],
        "reported_on": reported.isoformat() if reported else "",
        "evidence": str(item.get("evidence") or item.get("proof") or "").strip()[:400],
        "source_index": _as_int(item.get("source_index")),
    }


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _json_items(raw: str) -> list[Any]:
    """Pull trend objects out of one candidate string (array, wrapper, or single)."""
    candidates: list[Any] = []
    # Prefer array
    start = raw.find("[")
    end = raw.rfind("]")
    if start >= 0 and end > start:
        try:
            candidates.append(json.loads(raw[start : end + 1]))
        except json.JSONDecodeError:
            pass
    # Or object wrapper {"trends":[...]} / {"scams":[...]}
    ostart = raw.find("{")
    oend = raw.rfind("}")
    if ostart >= 0 and oend > ostart:
        try:
            candidates.append(json.loads(raw[ostart : oend + 1]))
        except json.JSONDecodeError:
            pass

    for cand in candidates:
        if isinstance(cand, list):
            return cand
        if isinstance(cand, dict):
            for key in ("trends", "scams", "items", "results", "data"):
                if isinstance(cand.get(key), list):
                    return cand[key]
            if any(k in cand for k in ("title", "description", "name")):
                return [cand]
    return []


def _scan_json_objects(raw: str) -> list[dict[str, Any]]:
    """Salvage every balanced ``{...}`` block, at any nesting depth.

    Handles output truncated mid-array (the wrapper never closes, so the trend
    objects sit at depth 1) and JSON buried in prose.
    """
    out: list[dict[str, Any]] = []
    starts: list[int] = []
    in_str = False
    escaped = False
    for i, ch in enumerate(raw):
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            starts.append(i)
        elif ch == "}" and starts:
            start = starts.pop()
            try:
                obj = json.loads(raw[start : i + 1])
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                out.append(obj)
    return out


def _parse_trends_json(text: str, *, needed: int) -> list[dict[str, Any]]:
    raw = (text or "").strip()
    if not raw:
        return []
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()

    items = _json_items(raw)
    if not items:
        # Some models echo the braces from the prompt's JSON example doubled.
        collapsed = raw.replace("{{", "{").replace("}}", "}")
        if collapsed != raw:
            items = _json_items(collapsed)
            raw = collapsed
    if not items:
        # Truncated output (hit max_tokens) or JSON buried in prose.
        items = [o for o in _scan_json_objects(raw) if any(k in o for k in ("title", "name"))]

    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        norm = _normalize_trend_item(item)
        if not norm:
            continue
        out.append(norm)
        if len(out) >= needed:
            break
    return out


def _trends_from_snippets(
    snippets: list[dict[str, str]],
    *,
    needed: int,
    custom_query: str = "",
) -> list[dict[str, Any]]:
    """Deterministic fallback when the LLM returns unusable JSON."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    focus = (custom_query or "").lower()
    for s in snippets:
        title = str(s.get("title") or "").strip()
        body = str(s.get("body") or s.get("page_text") or "").strip()
        if not title or len(title) < 8:
            continue
        low = f"{title} {body}".lower()
        if focus and focus not in low and not any(
            w in low for w in ("scam", "fraud", "phishing", "otp", "upi", "cheat")
        ):
            # still allow if clearly scam-related words present via title alone
            if not any(w in title.lower() for w in ("scam", "fraud", "phishing", "otp", "upi")):
                continue
        if not any(w in low for w in ("scam", "fraud", "phishing", "otp", "upi", "cyber", "cheat", "fake")):
            continue
        key = re.sub(r"\W+", " ", title.lower()).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        desc = body if len(body) >= 24 else f"{title}. Reported online scam / fraud pattern."
        out.append(
            {
                "title": title[:200],
                "description": desc[:2000],
                "scam_type": "Online Fraud",
                "risk_level": "High" if any(w in low for w in ("otp", "upi", "bank", "kyc")) else "Medium",
                "city": _guess_place_from_text(f"{title} {body}"),
                "state": "",
                "lat": None,
                "lon": None,
                "location_basis": "",
                "source_index": None,
                "source_url": str(s.get("href") or "").strip(),
            }
        )
        if len(out) >= needed:
            break
    return out


def _extract_scams_with_llm(
    *,
    provider: str,
    model: str,
    target_date: str,
    snippets: list[dict[str, str]],
    needed: int,
    custom_query: str = "",
    trends_cfg: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], int, int, str]:
    """Returns (trends, dropped_unevidenced, dropped_stale, unparsed_sample)."""
    if not snippets or needed <= 0:
        return [], 0, 0, ""
    cfg = trends_cfg or get_trends_config()
    corpus_parts = []
    for i, s in enumerate(snippets[:12], 1):
        corpus_parts.append(
            f"[{i}] TITLE: {s.get('title','')}\nPUBLISHED: {s.get('published','') or 'unknown'}\n"
            f"URL: {s.get('href','')}\nSNIPPET: {s.get('body','')}\n"
            f"PAGE: {s.get('page_text','')[:2500]}"
        )
    corpus = "\n\n".join(corpus_parts)
    focus = f"\nAdmin focus query (prioritize matching themes): {custom_query}" if custom_query else ""
    recency_days = int(cfg.get("recency_days") or 0)
    window = (
        f"Only return scams reported on or after {_recency_cutoff(target_date, recency_days)} "
        f"(within {recency_days} days of {target_date}). Drop anything older.\n"
        if recency_days > 0
        else ""
    )
    system = SystemMessage(
        content=(
            f"{str(cfg.get('system_prompt') or DEFAULT_SYSTEM_PROMPT).strip()}\n\n"
            "OUTPUT — return ONLY valid JSON: a JSON array, or "
            '{"trends":[...]}. No markdown, no commentary, and never double or escape the '
            "JSON braces. Each object has exactly these keys:\n"
            f"{schema_hint()}\n"
            "Never fall back to the search area or to 'India' just to fill a location field."
            + (
                "\nWhen an admin focus query is provided, prefer trends that match that theme."
                if custom_query
                else ""
            )
        )
    )
    human = HumanMessage(
        content=(
            f"Today / date focus: {target_date}\n{window}{focus}"
            f"Return up to {needed} distinct scam trends as JSON. "
            "If several sources describe the same scheme, merge them into one object. "
            "Return an empty array if none of the sources report a real, dated incident.\n\n"
            f"SOURCE MATERIAL:\n{corpus}"
        )
    )
    text = ""
    try:
        response = invoke_llm_with_selection(
            provider,
            model,
            [system, human],
            task_id="scam_trends.extract",
            temperature=0.1,
            # Thinking models spend part of this budget before emitting JSON.
            max_tokens=8000,
        )
        content = getattr(response, "content", "") or ""
        if isinstance(content, list):
            content = " ".join(
                str(p.get("text") if isinstance(p, dict) else p) for p in content
            )
        text = str(content).strip()
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ scam_trends LLM extract failed ({provider}/{model}): {exc}")
        text = ""

    out = _parse_trends_json(text, needed=needed)
    if out:
        # Attach the source article the model cited so admins can read the original.
        for item in out:
            idx = item.pop("source_index", None)
            if isinstance(idx, int) and 1 <= idx <= len(snippets):
                item["source_url"] = str(snippets[idx - 1].get("href") or "").strip()
                item.setdefault("published", str(snippets[idx - 1].get("published") or ""))
            else:
                item.setdefault("source_url", "")
        kept, unreal, stale = _filter_extracted(out, target_date=target_date, cfg=cfg)
        if unreal or stale:
            print(
                f"ℹ️ scam_trends filtered {unreal} unevidenced and {stale} stale item(s) "
                f"from {len(out)} extracted"
            )
        return kept, unreal, stale, ""
    sample = re.sub(r"\s+", " ", text)[:240]
    if text:
        print(f"⚠️ scam_trends LLM returned unusable JSON (first 240 chars): {sample!r}")
    if cfg.get("strict_filters"):
        # The snippet fallback cannot tell a reported incident from an explainer.
        print("ℹ️ scam_trends skipping snippet fallback (strict filters on)")
        return [], 0, 0, sample
    # Free / flaky models often return prose — fall back to snippet-derived trends.
    fallback = _trends_from_snippets(snippets, needed=needed, custom_query=custom_query)
    if fallback:
        print(f"ℹ️ scam_trends using snippet fallback ({len(fallback)} items) after LLM parse miss")
    return fallback, 0, 0, sample


def _dedupe_key(item: dict[str, str]) -> str:
    """Normalize title (+ short description) for in-batch near-duplicate detection."""
    title = re.sub(r"[^\w\s]", " ", (item.get("title") or "").lower())
    title = re.sub(r"\s+", " ", title).strip()
    desc = re.sub(r"[^\w\s]", " ", (item.get("description") or "")[:120].lower())
    desc = re.sub(r"\s+", " ", desc).strip()
    # Prefer title-only when title is informative enough to catch near-dupes.
    if len(title) >= 12:
        return title
    return re.sub(r"\s+", " ", f"{title} {desc}").strip()


_EXTRA_COLUMNS_CACHE: Optional[bool] = None
_DRAFT_EXTRA_COLUMNS = (
    "state",
    "location_source",
    "location_basis",
    "source_url",
    "reported_on",
    "evidence",
)


def _has_extra_columns() -> bool:
    """Migration 029/030 columns may be missing on a not-yet-migrated deployment."""
    global _EXTRA_COLUMNS_CACHE
    if _EXTRA_COLUMNS_CACHE is not None:
        return _EXTRA_COLUMNS_CACHE
    if not is_postgres_configured():
        _EXTRA_COLUMNS_CACHE = False
        return False
    try:
        row = execute_one(
            """
            SELECT COUNT(*)::int AS n
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'scam_trend_drafts'
              AND column_name = ANY(%s)
            """,
            (list(_DRAFT_EXTRA_COLUMNS),),
        )
        _EXTRA_COLUMNS_CACHE = int((row or {}).get("n") or 0) == len(_DRAFT_EXTRA_COLUMNS)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ scam_trend_drafts column probe failed: {exc}")
        _EXTRA_COLUMNS_CACHE = False
    if not _EXTRA_COLUMNS_CACHE:
        print("ℹ️ scam_trend_drafts is missing migration 029/030 columns — run scripts/migrate_postgres.py")
    return _EXTRA_COLUMNS_CACHE


_DRAFT_BASE_COLUMNS = (
    "id, run_id, seq, status, title, description, scam_type, risk_level, city, "
    "lat, lon, similar_to_existing, similarity_score, promoted_mock_scam_id, "
    "created_at, updated_at"
)


def _draft_select_columns() -> str:
    if not _has_extra_columns():
        return _DRAFT_BASE_COLUMNS
    extras = ", ".join(_DRAFT_EXTRA_COLUMNS)
    return _DRAFT_BASE_COLUMNS.replace("city, ", f"city, {extras}, ")


def _insert_draft(
    *,
    draft_id: str,
    run_id: str,
    seq: int,
    title: str,
    description: str,
    scam_type: str,
    risk_level: str,
    city: str,
    state: str | None,
    lat: float | None,
    lon: float | None,
    location_source: str | None,
    location_basis: str | None,
    source_url: str | None,
    reported_on: str | None,
    evidence: str | None,
    embedding: list[float] | None,
    similar_to_existing: bool,
    similarity_score: float | None,
) -> bool:
    if not is_postgres_configured():
        return True
    values: list[Any] = [
        draft_id,
        run_id,
        seq,
        title,
        description,
        scam_type,
        risk_level,
        city,
        lat,
        lon,
    ]
    columns = (
        "id, run_id, seq, status, title, description, scam_type, risk_level, city, lat, lon"
    )
    placeholders = "%s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s"
    if _has_extra_columns():
        columns += ", state, location_source, location_basis, source_url, reported_on, evidence"
        placeholders += ", %s, %s, %s, %s, %s::date, %s"
        values.extend(
            [state, location_source, location_basis, source_url, reported_on or None, evidence]
        )
    if embedding:
        columns += ", embedding"
        placeholders += ", %s::vector"
        values.append(_format_pgvector(embedding))
    columns += ", similar_to_existing, similarity_score"
    placeholders += ", %s, %s"
    values.extend([similar_to_existing, similarity_score])
    try:
        execute_void(
            f"INSERT INTO public.scam_trend_drafts ({columns}) VALUES ({placeholders})",
            tuple(values),
        )
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ scam_trend_drafts insert failed: {exc}")
        return False


def _sanitize_draft(row: dict[str, Any]) -> dict[str, Any]:
    out = _sanitize(row)
    out.pop("embedding", None)
    return out


def _sync_run_draft_counts(run_id: str) -> None:
    """Refresh approved_count / promoted_count / extracted_count from drafts."""
    if is_postgres_configured():
        try:
            row = execute_one(
                """
                SELECT
                  COUNT(*)::int AS extracted,
                  COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                  COUNT(*) FILTER (WHERE status = 'promoted')::int AS promoted
                FROM public.scam_trend_drafts
                WHERE run_id = %s
                """,
                (run_id,),
            )
            if row:
                _update_run(
                    run_id,
                    extracted_count=int(row.get("extracted") or 0),
                    approved_count=int(row.get("approved") or 0),
                    promoted_count=int(row.get("promoted") or 0),
                    stored_count=0,
                )
                return
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ scam_trend_drafts count sync failed: {exc}")
    with _DRAFTS_LOCK:
        drafts = list(_DRAFTS.get(run_id) or [])
    _update_run(
        run_id,
        extracted_count=len(drafts),
        approved_count=sum(1 for d in drafts if d.get("status") == "approved"),
        promoted_count=sum(1 for d in drafts if d.get("status") == "promoted"),
        stored_count=0,
    )


def list_drafts(run_id: str) -> list[dict[str, Any]]:
    if is_postgres_configured():
        try:
            rows = execute(
                f"""
                SELECT {_draft_select_columns()}
                FROM public.scam_trend_drafts
                WHERE run_id = %s
                ORDER BY seq ASC
                """,
                (run_id,),
            )
            if rows:
                return [_sanitize_draft(r) for r in rows]
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ list_drafts failed: {exc}")
    with _DRAFTS_LOCK:
        return [dict(d) for d in (_DRAFTS.get(run_id) or [])]


def set_draft_status(draft_id: str, status: str) -> dict[str, Any]:
    status = (status or "").strip().lower()
    if status not in ("draft", "approved", "rejected"):
        raise ValueError("status must be draft, approved, or rejected")

    if is_postgres_configured():
        row = execute_one(
            "SELECT * FROM public.scam_trend_drafts WHERE id = %s",
            (draft_id,),
        )
        if not row:
            raise ValueError("Draft not found")
        if (row.get("status") or "") == "promoted":
            raise ValueError("Promoted drafts cannot change status")
        execute_void(
            """
            UPDATE public.scam_trend_drafts
            SET status = %s, updated_at = now()
            WHERE id = %s AND status <> 'promoted'
            """,
            (status, draft_id),
        )
        run_id = str(row["run_id"])
        _sync_run_draft_counts(run_id)
        updated = execute_one(
            f"SELECT {_draft_select_columns()} FROM public.scam_trend_drafts WHERE id = %s",
            (draft_id,),
        )
        return _sanitize_draft(updated or row)

    with _DRAFTS_LOCK:
        for run_id, drafts in _DRAFTS.items():
            for d in drafts:
                if str(d.get("id")) == draft_id:
                    if d.get("status") == "promoted":
                        raise ValueError("Promoted drafts cannot change status")
                    d["status"] = status
                    d["updated_at"] = _utcnow().isoformat()
                    _sync_run_draft_counts(run_id)
                    return dict(d)
    raise ValueError("Draft not found")


def approve_all_drafts(run_id: str) -> dict[str, Any]:
    if not get_run(run_id):
        raise ValueError("Run not found")
    if is_postgres_configured():
        row = execute_one(
            """
            WITH updated AS (
              UPDATE public.scam_trend_drafts
              SET status = 'approved', updated_at = now()
              WHERE run_id = %s
                AND status NOT IN ('approved', 'rejected', 'promoted')
              RETURNING id
            )
            SELECT COUNT(*)::int AS approved FROM updated
            """,
            (run_id,),
        )
        approved = int((row or {}).get("approved") or 0)
        _sync_run_draft_counts(run_id)
        return {"success": True, "approved": approved}

    count = 0
    with _DRAFTS_LOCK:
        for d in _DRAFTS.get(run_id) or []:
            if d.get("status") not in ("approved", "rejected", "promoted"):
                d["status"] = "approved"
                d["updated_at"] = _utcnow().isoformat()
                count += 1
    _sync_run_draft_counts(run_id)
    return {"success": True, "approved": count}


def promote_approved_drafts(run_id: str) -> dict[str, Any]:
    """Promote approved drafts into mock_scams."""
    from backend.database import supabase_db

    if not get_run(run_id):
        raise ValueError("Run not found")

    drafts = list_drafts(run_id)
    approved = [d for d in drafts if d.get("status") == "approved"]
    if not approved:
        raise ValueError("No approved drafts to promote")

    promoted = 0
    failed: list[str] = []

    for d in approved:
        draft_id = str(d["id"])
        emb = None
        if is_postgres_configured():
            try:
                emb_row = execute_one(
                    "SELECT embedding::text AS embedding FROM public.scam_trend_drafts WHERE id = %s",
                    (draft_id,),
                )
                raw = (emb_row or {}).get("embedding")
                if raw:
                    # reuse parse from postgres_db if available
                    from backend.database.postgres_db import _parse_embedding

                    emb = _parse_embedding(raw)
            except Exception as exc:  # noqa: BLE001
                print(f"⚠️ draft embedding load failed: {exc}")

        city = str(d.get("city") or "").strip()
        lat = d.get("lat")
        lon = d.get("lon")
        try:
            lat_f = float(lat) if lat is not None else None
            lon_f = float(lon) if lon is not None else None
        except (TypeError, ValueError):
            lat_f, lon_f = None, None
        if lat_f is None or lon_f is None:
            city, lat_f, lon_f, _ = finalize_trend_location(
                {"city": city, "state": d.get("state"), "lat": None, "lon": None}
            )
            city = city or "India"
            # Persist resolved coords on the draft for the drawer / retries.
            if is_postgres_configured():
                try:
                    execute_void(
                        """
                        UPDATE public.scam_trend_drafts
                        SET city = %s, lat = %s, lon = %s, updated_at = now()
                        WHERE id = %s
                        """,
                        (city, lat_f, lon_f, draft_id),
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f"⚠️ draft location backfill failed: {exc}")
        city = city or "India"

        scam_id = supabase_db.insert_mock_scam_with_embedding(
            title=str(d.get("title") or "Untitled"),
            description=str(d.get("description") or ""),
            scam_type=str(d.get("scam_type") or "Unknown"),
            risk_level=str(d.get("risk_level") or "Medium"),
            city=city,
            lat=lat_f,
            lon=lon_f,
            embedding=emb,
        )
        if not scam_id:
            failed.append(draft_id)
            continue

        if is_postgres_configured():
            execute_void(
                """
                UPDATE public.scam_trend_drafts
                SET status = 'promoted',
                    promoted_mock_scam_id = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (str(scam_id), draft_id),
            )
        else:
            with _DRAFTS_LOCK:
                for md in _DRAFTS.get(run_id) or []:
                    if str(md.get("id")) == draft_id:
                        md["status"] = "promoted"
                        md["promoted_mock_scam_id"] = str(scam_id)
                        md["updated_at"] = _utcnow().isoformat()
                        break
        promoted += 1

    _sync_run_draft_counts(run_id)
    run = get_run(run_id) or {}
    msg = f"Promoted {promoted} draft(s) into mock_scams"
    if failed:
        msg += f" ({len(failed)} failed)"
    _update_run(run_id, message=msg)
    return {
        "success": True,
        "promoted": promoted,
        "failed": failed,
        "run": get_run(run_id) or run,
    }


def claim_run(run_id: str) -> bool:
    """Atomically move a specific run from queued → running. True if we claimed it."""
    if is_postgres_configured():
        try:
            row = execute_one(
                """
                UPDATE public.scam_trend_runs
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
            print(f"⚠️ scam_trends claim_run failed: {exc}")
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
            # On Cloud Run, only the sync process HTTP request may run the job.
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
        threading.Thread(target=_work, name=f"scam-trends-{run_id[:8]}", daemon=True).start()
    return get_run(run_id)


def process_run(run_id: str) -> None:
    """Execute one scam-trends job (called by the dedicated worker or inline fallback)."""
    run = get_run(run_id)
    if not run:
        return
    if run.get("status") in ("completed", "failed"):
        return
    _update_run(run_id, status="running", progress=5, message="Searching the web…")
    try:
        areas = run.get("areas") or ["India"]
        if isinstance(areas, str):
            try:
                areas = json.loads(areas)
            except Exception:
                areas = ["India"]
        areas = [str(a) for a in areas if a] or ["India"]
        target_date = str(run.get("target_date") or date.today().isoformat())[:10]
        requested = int(run.get("requested_count") or 10)
        provider = str(run.get("provider") or "groq")
        model = str(run.get("model") or "")
        cfg = run.get("config") or {}
        if isinstance(cfg, str):
            try:
                cfg = json.loads(cfg)
            except Exception:
                cfg = {}
        custom_query = str(run.get("custom_query") or (cfg or {}).get("custom_query") or "").strip()[:240]
        if not model:
            raise ValueError("A model must be selected for scam trend extraction")

        trends_cfg = get_trends_config()
        blocked = [str(d) for d in (trends_cfg.get("blocked_domains") or [])]
        timelimit = str(trends_cfg.get("search_timelimit") or "")
        use_news = bool(trends_cfg.get("prefer_news"))
        dropped_unreal = 0
        dropped_stale = 0
        dropped_hosts = 0
        unparsed_sample = ""

        collected: list[dict[str, str]] = []
        seen: set[str] = set()
        searched = 0
        per_area = max(3, (requested // max(len(areas), 1)) + 2)

        for ai, area in enumerate(areas):
            if len(collected) >= requested:
                break
            # Incident-shaped queries: police/complaint wording beats "what is X scam".
            queries = [
                f"{area} cyber police scam complaint FIR victims news",
                f"online fraud case reported {area} India {target_date[:7]}",
            ]
            if custom_query:
                queries = [
                    f"{custom_query} {area} India scam case reported",
                    f"{custom_query} fraud complaint {area} India news",
                ]
            snippets: list[dict[str, str]] = []
            for qi, q in enumerate(queries):
                _update_run(
                    run_id,
                    progress=min(5 + int(20 * (ai + (qi + 0.5) / max(len(queries), 1)) / max(len(areas), 1)), 30),
                    searched_count=searched,
                    message=f"Searching web ({area})… query {qi + 1}/{len(queries)}",
                )
                hits = _search_web(
                    q, max_results=6, timeout_sec=12.0, timelimit=timelimit, news=use_news
                )
                if not hits and use_news:
                    # News index can come back empty for narrow queries.
                    hits = _search_web(q, max_results=6, timeout_sec=12.0, timelimit=timelimit)
                searched += len(hits)
                for h in hits[:6]:
                    if _blocked_host(str(h.get("href") or ""), blocked):
                        dropped_hosts += 1
                        continue
                    body = (h.get("body") or "").strip()
                    snippets.append({**h, "page_text": body})
                _update_run(
                    run_id,
                    searched_count=searched,
                    message=f"Searching web ({area})… query {qi + 1}/{len(queries)} ({len(hits)} hits)",
                )
                time.sleep(0.2)

            # Read the articles themselves — the model needs the body text to place
            # each scam on the map. Slow hosts are dropped once the budget expires.
            if snippets:
                _update_run(
                    run_id,
                    searched_count=searched,
                    message=f"Reading {len(snippets)} article(s) for {area}…",
                )
                pages = _fetch_pages(snippets, budget_sec=_PAGE_FETCH_BUDGET_SEC)
                _update_run(
                    run_id,
                    searched_count=searched,
                    message=f"Read {pages}/{len(snippets)} article(s) for {area}",
                )

            if not snippets:
                _update_run(
                    run_id,
                    searched_count=searched,
                    message=f"No search hits for {area}; trying next area…",
                )
                continue

            progress = 30 + int(50 * (ai + 0.5) / max(len(areas), 1))
            _update_run(
                run_id,
                progress=min(progress, 80),
                searched_count=searched,
                message=f"Extracting trends for {area}…",
            )

            needed = requested - len(collected)
            extracted, unreal, stale, sample = _extract_scams_with_llm(
                provider=provider,
                model=model,
                target_date=target_date,
                snippets=snippets,
                needed=min(needed, per_area),
                custom_query=custom_query,
                trends_cfg=trends_cfg,
            )
            dropped_unreal += unreal
            dropped_stale += stale
            unparsed_sample = sample or unparsed_sample
            for item in extracted:
                key = _dedupe_key(item)
                if not key or key in seen:
                    continue
                seen.add(key)
                collected.append(item)
                if len(collected) >= requested:
                    break

        if not collected:
            if searched <= 0:
                raise ValueError(
                    "No web search hits. DuckDuckGo may be blocked/rate-limited, "
                    "or ddgs is missing. Try again or set a custom query."
                )
            if dropped_unreal or dropped_stale:
                raise ValueError(
                    f"Search found {searched} pages but every extracted trend was filtered "
                    f"out ({dropped_unreal} without a reported incident, {dropped_stale} older "
                    f"than {trends_cfg.get('recency_days')} days). Widen the recency window or "
                    "relax the system prompt in Edit system prompt, or try a clearer custom query."
                )
            detail = f" Model said: {unparsed_sample}" if unparsed_sample else ""
            raise ValueError(
                f"Search found {searched} pages but no trends could be extracted "
                f"(model {provider}/{model} returned unusable output). Try another model "
                f"or a clearer custom query.{detail}"
            )

        _update_run(
            run_id,
            progress=85,
            searched_count=searched,
            message=f"Staging {len(collected)} trends for approval…",
        )

        from backend.database import supabase_db

        staged = 0
        near_existing = 0
        results: list[dict[str, Any]] = []
        mem_drafts: list[dict[str, Any]] = []

        for seq, item in enumerate(collected[:requested]):
            text = f"{item['title']}. {item['description']}"
            similar: list[Any] = []
            try:
                similar = supabase_db.find_similar_mock_scam_trends(
                    query_text=text[:4000],
                    city=None,
                    limit=1,
                    similarity_threshold=_SIMILARITY_FLAG,
                    lookback_days=365,
                ) or []
            except Exception as exc:  # noqa: BLE001
                print(f"⚠️ trend similarity check failed: {exc}")
                similar = []

            sim_score = None
            is_similar = bool(similar)
            if is_similar:
                near_existing += 1
                try:
                    sim_score = float(similar[0].get("similarity") or 0)
                except Exception:
                    sim_score = None

            emb = None
            try:
                vecs = embedding_admin._embed_texts([text[:4000]])
                emb = vecs[0] if vecs else None
            except Exception as exc:  # noqa: BLE001
                print(f"⚠️ trend embed failed: {exc}")

            # The model read the article and named the place; we only geocode when
            # it could not, so the search area never leaks into the stored location.
            resolved_city, lat, lon, loc_source = finalize_trend_location(item)

            draft_id = str(uuid.uuid4())
            draft_row = {
                "id": draft_id,
                "run_id": run_id,
                "seq": seq,
                "status": "draft",
                "title": item.get("title") or "Untitled",
                "description": item.get("description") or "",
                "scam_type": item.get("scam_type") or "Unknown",
                "risk_level": item.get("risk_level") or "Medium",
                "city": resolved_city,
                "state": str(item.get("state") or "") or None,
                "lat": lat,
                "lon": lon,
                "location_source": loc_source,
                "location_basis": str(item.get("location_basis") or "") or None,
                "source_url": str(item.get("source_url") or "") or None,
                "reported_on": str(item.get("reported_on") or "") or None,
                "evidence": str(item.get("evidence") or "") or None,
                "similar_to_existing": is_similar,
                "similarity_score": sim_score,
                "promoted_mock_scam_id": None,
                "created_at": _utcnow().isoformat(),
                "updated_at": _utcnow().isoformat(),
            }

            ok = _insert_draft(
                draft_id=draft_id,
                run_id=run_id,
                seq=seq,
                title=draft_row["title"],
                description=draft_row["description"],
                scam_type=draft_row["scam_type"],
                risk_level=draft_row["risk_level"],
                city=draft_row["city"],
                state=draft_row["state"],
                lat=lat,
                lon=lon,
                location_source=loc_source,
                location_basis=draft_row["location_basis"],
                source_url=draft_row["source_url"],
                reported_on=draft_row["reported_on"],
                evidence=draft_row["evidence"],
                embedding=emb,
                similar_to_existing=is_similar,
                similarity_score=sim_score,
            )
            if ok:
                staged += 1
                mem_drafts.append(draft_row)
            results.append(
                {
                    "id": draft_id,
                    "title": draft_row["title"],
                    "description": draft_row["description"],
                    "scam_type": draft_row["scam_type"],
                    "risk_level": draft_row["risk_level"],
                    "city": draft_row["city"],
                    "state": draft_row["state"],
                    "lat": lat,
                    "lon": lon,
                    "location_source": loc_source,
                    "source_url": draft_row["source_url"],
                    "reported_on": draft_row["reported_on"],
                    "status": "draft" if ok else "failed",
                    "similar_to_existing": is_similar,
                    "similarity_score": sim_score,
                    "stored": False,
                    "skipped_duplicate": False,
                }
            )
            _update_run(
                run_id,
                extracted_count=staged,
                stored_count=0,
                progress=85 + int(10 * staged / max(len(collected), 1)),
            )

        if mem_drafts:
            with _DRAFTS_LOCK:
                _DRAFTS[run_id] = mem_drafts

        cfg_out = dict(cfg) if isinstance(cfg, dict) else {}
        cfg_out["results"] = results
        err = None
        if staged == 0 and results:
            msg = f"Extracted {len(results)} trends but failed to stage drafts"
            err = "Insert into scam_trend_drafts failed (check migration 021 / server logs)"
        elif near_existing:
            msg = (
                f"Staged {staged} drafts for approval "
                f"({near_existing} similar to existing mock_scams — review before promote)"
            )
        else:
            msg = f"Staged {staged} drafts for approval"
        if dropped_unreal or dropped_stale or dropped_hosts:
            msg += (
                f" · filtered {dropped_unreal} unevidenced, {dropped_stale} stale, "
                f"{dropped_hosts} blocked-domain hit(s)"
            )

        _update_run(
            run_id,
            status="completed",
            progress=100,
            stored_count=0,
            extracted_count=staged,
            approved_count=0,
            promoted_count=0,
            searched_count=searched,
            message=msg,
            error=err,
            config=cfg_out,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"❌ scam_trends_scraper failed ({run_id}): {exc}")
        _update_run(
            run_id,
            status="failed",
            progress=100,
            error=str(exc),
            message="Failed",
        )


# Backwards-compatible name used by older call sites / docs
_run_worker = process_run
