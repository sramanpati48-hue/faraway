import os
import sys
import uuid
import json
import certifi

from backend.stdio_safe import install as _install_stdio

_install_stdio()
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Response, Depends
from pydantic import BaseModel
import httpx
from typing import Optional, List, Dict, Any

os.environ['SSL_CERT_FILE'] = certifi.where()
from backend.agent_graph import agent_graph
from langchain_core.messages import HumanMessage
from fastapi import WebSocket, WebSocketDisconnect
from backend.websocket_manager import manager
from backend.database.pdf_service import generate_and_upload_report_pdf
from backend.agents.response_sanitize import strip_classification_block
import backend.clash_service as clash_service
from backend.clash_schemas import ClashAnswerRequest, ClashCaseInput, ClashSessionCreate
from backend import case_dispatcher
from backend.database.auth_middleware import get_current_user
from backend.database.postgres_pool import DbConnectionError

app = FastAPI(title="NyaySahayak API", description="AI Agentic Legal Assistant", root_path="/apis")

from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

import backend.database.supabase_db as supabase_db
import backend.database.vector_db as vdb
from fastapi.responses import RedirectResponse, StreamingResponse, JSONResponse, Response
from io import BytesIO
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

_cors_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:3001,"
        "http://127.0.0.1:3000,http://127.0.0.1:3001,"
        "https://hiringassistant-ai.vercel.app,"
        "https://nyaysahayak-gold.vercel.app,"
        "https://nyaysahayakxprize.vercel.app,"
        "https://nyaysahayak.eu.cc,"
        "https://vps-3965724c.vps.ovh.net",
    ).split(",")
    if o.strip()
]
# Allow common local/dev hosts (LAN IP from Next.js "Network" URL, etc.)
_cors_origin_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"https?://("
    r"localhost|127\.0\.0\.1|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UptimeRobotCompatMiddleware(BaseHTTPMiddleware):
    """UptimeRobot free tier only sends HEAD (no POST / custom headers).

    Short-circuit those probes so they never 405 against POST-only routes.
    """

    async def dispatch(self, request: StarletteRequest, call_next):
        from fastapi import HTTPException as FastAPIHTTPException
        from backend.routes.cron_routes import (
            PING_PATHS,
            TICK_PATHS,
            classifier_tick_http_response,
        )

        path = request.url.path.rstrip("/") or "/"
        method = request.method.upper()
        if method == "HEAD" and path in PING_PATHS:
            return Response(status_code=200)
        if method in ("HEAD", "GET") and path in TICK_PATHS:
            try:
                return classifier_tick_http_response(
                    method,
                    request.headers.get("x-cron-secret"),
                    request.query_params.get("secret"),
                )
            except FastAPIHTTPException as exc:
                return Response(status_code=exc.status_code)
        return await call_next(request)


app.add_middleware(UptimeRobotCompatMiddleware)


@app.exception_handler(DbConnectionError)
async def db_connection_error_handler(request: StarletteRequest, exc: DbConnectionError):
    return JSONResponse(status_code=503, content={"detail": f"Database unavailable: {exc}"})

from backend.routes.auth_routes import router as auth_router
from backend.routes.lawyer_chat_routes import router as lawyer_chat_router
from backend.routes.sahayak_chat_routes import router as sahayak_chat_router
from backend.routes.chat_unread_routes import router as chat_unread_router
from backend.routes.moderator_routes import router as moderator_router
from backend.routes.admin_routes import router as admin_router
from backend.routes.cron_routes import router as cron_router
from backend.routes.seo_routes import router as seo_router
from backend.routes.backup_routes import router as backup_router
from backend.routes.clash_billing_routes import router as clash_billing_router
from backend.routes.local_justice_routes import router as local_justice_router
from backend.routes.policy_routes import router as policy_router
from backend.routes.nyayguide_routes import router as nyayguide_router
from backend.voice.routes import router as voice_router

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(cron_router)  # GET+POST /api/cron/* (UptimeRobot / GitHub Actions)
app.include_router(seo_router)
app.include_router(lawyer_chat_router)
app.include_router(sahayak_chat_router)
app.include_router(chat_unread_router)
app.include_router(moderator_router)
app.include_router(backup_router)
app.include_router(clash_billing_router)
app.include_router(local_justice_router)
app.include_router(policy_router)
app.include_router(nyayguide_router)
app.include_router(voice_router)

# Case assignment is push-on-create via case_dispatcher (no DB poller).

@app.on_event("startup")
async def _remember_ws_loop():
    """Pin the FastAPI event loop so sync agents can schedule WS pushes."""
    manager._remember_loop()
    # Optional always-on worker loop (costs money on Cloud Run: needs min-instances
    # and --no-cpu-throttling). Default OFF — jobs run via POST .../process inside
    # the request that the admin UI fires (scale-to-zero friendly).
    # Opt in: RUN_BACKGROUND_WORKER=1  or  python -m backend.workers.background_worker
    _bw = (os.getenv("RUN_BACKGROUND_WORKER") or "0").strip().lower()
    if _bw in ("1", "true", "yes", "on"):
        try:
            from backend.workers.background_worker import start_in_background

            start_in_background()
        except Exception as exc:  # noqa: BLE001
            # ASCII-only: Windows cp1252 consoles raise on emoji and abort startup.
            print(f"[warn] background worker failed to start in-process: {exc}")
    else:
        print(
            "[info] always-on background worker off "
            "(jobs use POST .../process; no min-instances needed)"
        )
    # Lightweight SLA delay ticker for moderator queue (also available via cron)
    try:
        from backend.services.moderator_queue import start_sla_ticker_in_background

        start_sla_ticker_in_background()
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] moderator SLA ticker failed to start: {exc}")

class UserQuery(BaseModel):
    query: str
    user_id: str
    user_name: Optional[str] = "User"  # Display name for lawyer case forwarding
    location: Optional[dict] = None  # Optional location data {lat: float, lon: float}
    session_history: Optional[List[Dict[str, Any]]] = None  # Last N messages from the chat for context
    session_id: Optional[str] = None  # Session ID for this conversation
    attachments: Optional[List[Dict[str, Any]]] = None

class AuthPayload(BaseModel):
    uid: str
    email: str
    role: Optional[str] = None

class ChatHistoryPayload(BaseModel):
    uid: str
    session_id: str
    session_data: List[Dict[str, Any]]

class CasePayload(BaseModel):
    uid: str
    case_id: str
    structured_report: Dict[str, Any]
    session_data: List[Dict[str, Any]]

class CaseCompletionPayload(BaseModel):
    """Payload for saving a completed case with situation summary and Q&A."""
    uid: str
    case_id: str
    session_id: str
    structured_report: Dict[str, Any]
    situation_summary: Dict[str, Any]
    collected_answers: Dict[str, str]
    session_data: List[Dict[str, Any]]
    user_language: str = "english"
    pdf_url: Optional[str] = None
    generate_pdf: bool = True


class CaseFollowupPayload(BaseModel):
    statement: str
    session_id: str
    role: str
    target_id: Optional[str] = None
    case_id: Optional[str] = None
    user_id: Optional[str] = None


class CasePDFGenerationPayload(BaseModel):
    """Payload for generating and uploading PDF for a case."""
    case_id: str
    user_id: str
    session_id: Optional[str] = None
    collected_answers: Optional[Dict[str, str]] = None
    structured_report: Optional[Dict[str, Any]] = None

@app.get("/")
async def root():
    return {"message": "Welcome to NyaySahayak API"}

@app.head("/health")
@app.get("/health")
@app.head("/api/health")
@app.get("/api/health")
@app.head("/ping")
@app.get("/ping")
@app.head("/api/ping")
@app.get("/api/ping")
async def health_check():
    return {"status": "ok", "service": "NyaySahayak API", "pong": True}



@app.post("/process-query")
async def process_query(user_query: UserQuery):
    """
    Endpoint to process user queries through the agentic flow.
    """
    print(f"\n{'='*50}")
    print(f"🚀 NEW QUERY RECEIVED")
    print(f"User ID: {user_query.user_id}")
    print(f"Query: {user_query.query}")
    if user_query.location:
        print(f"Location: {user_query.location}")
    print(f"{'='*50}\n")
    
    try:
        inputs = {
            "messages": [HumanMessage(content=user_query.query)],
            "user_details": {
                "user_id": user_query.user_id,
                "location": user_query.location,
                "session_id": user_query.session_id,
                "query": user_query.query
            }
        }
        
        # Invoke the graph with thread_id for persistence
        config = {"configurable": {"thread_id": user_query.user_id}}
        result = await agent_graph.ainvoke(inputs, config=config)
        
        final_response = result.get("final_response", "No response generated.")
        
        return {
            "status": "success",
            "query": user_query.query,
            "response": final_response,
            "structured_report": result.get("structured_report"),
            "suggested_actions": result.get("suggested_actions"),
            "trace": [str(m.content) for m in result.get("messages", [])]
        }
    except Exception as e:
        print(f"Error processing query: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- WebSocket Endpoints (presence + targeted push) ---

def _parse_presence_message(raw: str) -> dict:
    try:
        data = json.loads(raw) if raw else {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


@app.websocket("/ws/moderator")
async def websocket_moderator_endpoint(websocket: WebSocket):
    await manager.connect(websocket, channel="moderator")
    try:
        while True:
            data = await websocket.receive_text()
            payload = _parse_presence_message(data)
            if payload.get("type") in ("identify", "presence", "hello") or payload.get("uid"):
                manager.register_presence(
                    websocket,
                    uid=str(payload.get("uid") or ""),
                    role="moderator",
                    state=payload.get("state"),
                    city=payload.get("city"),
                    open_cases=int(payload.get("open_cases") or 0),
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel="moderator")
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket, channel="moderator")


@app.websocket("/ws/sahayak")
async def websocket_sahayak_endpoint(websocket: WebSocket):
    """WebSocket endpoint for sahayak guides to receive targeted case notifications."""
    await manager.connect(websocket, channel="sahayak")
    try:
        while True:
            data = await websocket.receive_text()
            payload = _parse_presence_message(data)
            if payload.get("type") in ("identify", "presence", "hello") or payload.get("uid"):
                manager.register_presence(
                    websocket,
                    uid=str(payload.get("uid") or ""),
                    role=str(payload.get("role") or "sahayak"),
                    state=payload.get("state"),
                    city=payload.get("city"),
                    open_cases=int(payload.get("open_cases") or 0),
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel="sahayak")
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket, channel="sahayak")

# --- Firebase Role Management & Auth Endpoints ---

@app.post("/api/auth/login")
async def auth_login(payload: AuthPayload):
    """
    Called by the frontend after a successful Auth sign-in to ensure 
    the user record and role exists. Supabase is the primary source of truth.
    """
    import asyncio

    # ── 1. Resolve existing role with Supabase precedence ──────────────────
    # Supabase is the source of truth.
    role_from_supabase = None

    try:
        role_from_supabase = await run_in_threadpool(supabase_db.get_user_role, payload.uid)
    except Exception:
        pass

    requested_role = (payload.role or "").strip().lower() or None
    role_priority = {
        "victim": 0,
        "sahayak": 1,
        "guide": 1,
        "nyay_guide": 1,
        "lawyer": 1,
        "moderator": 2,
        "admin": 3,
    }

    def _normalize_role_value(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        raw = str(value).strip().lower()
        alias_map = {
            "nyay guide": "sahayak",
            "nyay_guide": "sahayak",
            "guide": "sahayak",
        }
        return alias_map.get(raw, raw)

    existing_role = _normalize_role_value(role_from_supabase)
    requested_role = _normalize_role_value(requested_role)

    # ── 3. Determine role and respond ──────────────────────────────────────
    if existing_role:
        normalized_existing = str(existing_role).strip().lower()

        # Default login/refresh path: keep authoritative existing role.
        if requested_role is None or requested_role == "victim" or requested_role == normalized_existing:
            await run_in_threadpool(supabase_db.create_or_update_user, payload.uid, payload.email, normalized_existing)
            return {"status": "success", "role": normalized_existing, "message": "User exists"}

        # Explicit role change request: only allow non-downgrade transitions.
        if role_priority.get(requested_role, 0) >= role_priority.get(normalized_existing, 0):
            await run_in_threadpool(supabase_db.create_or_update_user, payload.uid, payload.email, requested_role)
            return {"status": "success", "role": requested_role, "message": "User role updated"}

        # Reject downgrade attempts and return current role.
        await run_in_threadpool(supabase_db.create_or_update_user, payload.uid, payload.email, normalized_existing)
        return {"status": "success", "role": normalized_existing, "message": "Role unchanged"}

    # New user or role upgrade
    role_to_save = requested_role or "victim"
    # Supabase write — always done, fast and reliable
    await run_in_threadpool(supabase_db.create_or_update_user, payload.uid, payload.email, role_to_save)

    # Read authoritative role post-upsert. This prevents transient lookup failures
    # from making moderators appear as victims in the login response.
    resolved_role = role_to_save
    try:
        role_after_sync = await run_in_threadpool(supabase_db.get_user_role, payload.uid)
        if role_after_sync:
            resolved_role = role_after_sync
    except Exception:
        pass

    return {"status": "success", "role": resolved_role, "message": "User created/updated"}

@app.post("/api/chat/history")
async def sync_chat_history(payload: ChatHistoryPayload):
    """
    Syncs local chat history to Firebase after the victim logs in.
    """
    success = await run_in_threadpool(supabase_db.save_chat_history, payload.uid, payload.session_id, payload.session_data)
    if success:
        return {"status": "success", "message": "Chat history synced"}
    raise HTTPException(status_code=500, detail="Failed to sync chat history")

@app.get("/api/chat/sessions")
async def get_all_chat_sessions(uid: str):
    """
    Retrieves all distinct chat sessions (cases) from Supabase for a given user.
    """
    sessions = await run_in_threadpool(supabase_db.get_all_chat_sessions, uid)
    return {"status": "success", "sessions": sessions}

@app.delete("/api/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str, uid: str):
    """Delete a chat session for the authenticated user."""
    success = await run_in_threadpool(supabase_db.delete_chat_session, uid, session_id)
    if success:
        return {"status": "success", "message": "Session deleted"}
    raise HTTPException(status_code=500, detail="Failed to delete session")

@app.get("/api/chat/history")
async def get_chat_history(uid: str, session_id: Optional[str] = None):
    """
    Retrieves chat history from Supabase for a given user, optionally filtered by session_id.
    """
    history = await run_in_threadpool(supabase_db.get_chat_history, uid, session_id)
    return {"status": "success", "history": history}

@app.get("/api/scams/nearby")
async def get_nearby_scams(lat: float, lon: float):
    """
    Reverse geocodes coordinates and fetches active local scams across India.
    Returns clustered mock scam data for heatmap visualization.
    """
    from backend.agents.common_utils import get_user_location_context
    
    city, state, loc_str = get_user_location_context({'lat': lat, 'lon': lon})
    
    if city == "Unknown" or city == "India":
        city = "Unknown"
        
    # Fetch mock data from Supabase for all-India heatmap
    mock_scams = await run_in_threadpool(supabase_db.get_all_mock_scams, 1000)
    
    return {
        "status": "success", 
        "city": city,
        "state": state,
        "location_string": loc_str,
        "scams": mock_scams
    }

class TTSPayload(BaseModel):
    text: str
    target_language_code: str = "hi-IN"
    speaker: str = "shubh"
    pace: float = 1.0
    speech_sample_rate: int = 22050
    enable_preprocessing: bool = False
    model: str = "bulbul:v3"
    temperature: float = 0.6
    enable_cached_responses: bool = False
    output_audio_codec: str = "mp3"
    output_audio_bitrate: str = "128k"

@app.post("/api/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language_code: str = Form("unknown"),
):
    """Proxy for Sarvam STT using saaras:v3 model"""
    sarvam_key = os.getenv("SARVAM_API_KEY")
    if not sarvam_key:
        raise HTTPException(status_code=500, detail="SARVAM_API_KEY not configured")
        
    audio_content = await file.read()
    if not audio_content or len(audio_content) < 500:
        raise HTTPException(
            status_code=400,
            detail="Audio content is too short or empty. Please speak clearly."
        )
    
    print(f"[STT Proxy] Received audio {file.filename}, bytes={len(audio_content)}, lang={language_code}")
    
    async with httpx.AsyncClient() as client:
        files = {"file": (file.filename or "recording.webm", audio_content, file.content_type or "audio/webm")}
        data = {
            "model": "saaras:v3",
            "language_code": language_code,
            "mode": "transcribe",
        }
        
        try:
            response = await client.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": sarvam_key},
                files=files,
                data=data,
                timeout=30.0
            )
        except httpx.RequestError as exc:
            print(f"Failed to reach Sarvam STT payload: {exc}")
            raise HTTPException(status_code=503, detail=f"Service Unavailable: Cannot reach transcription service. ({type(exc).__name__})")
        
        print(f"Sarvam STT Response ({response.status_code}): {response.text}")
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"STT failed: {response.text}")
            
        return response.json()

@app.post("/api/synthesize")
async def synthesize_speech(payload: TTSPayload):
    """Proxy for Sarvam Streaming TTS"""
    sarvam_key = os.getenv("SARVAM_API_KEY")
    if not sarvam_key:
        raise HTTPException(status_code=500, detail="SARVAM_API_KEY not configured")
        
    # We use httpx.AsyncClient streams to proxy the audio stream to the client
    client = httpx.AsyncClient()
    
    async def fetch_stream():
        try:
            async with client.stream(
                "POST", 
                "https://api.sarvam.ai/text-to-speech/stream",
                headers={"api-subscription-key": sarvam_key, "Content-Type": "application/json"},
                json=payload.dict(),
                timeout=30.0
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    print(f"Sarvam Stream TTS Error ({response.status_code}):", error_text.decode('utf-8', errors='ignore'))
                    # Instead of raising HTTPException inside the generator (which fails), we'll yield empty
                    return
                
                async for chunk in response.aiter_bytes():
                    yield chunk
        finally:
            await client.aclose()
            
    return StreamingResponse(fetch_stream(), media_type="audio/mpeg")

@app.post("/api/cases")
async def save_case(payload: CasePayload):
    """
    Saves a completed AI chat session and its structured report as a standalone Case.
    """
    success = await run_in_threadpool(
        supabase_db.save_user_case,
        payload.uid,
        payload.case_id,
        payload.structured_report,
        payload.session_data
    )
    if success:
        try:
            from backend.services.scam_case_classifier import embed_case_async

            embed_case_async(payload.case_id, payload.structured_report)
        except Exception as emb_err:  # noqa: BLE001
            print(f"⚠️ Could not start case embedding: {emb_err}")
        return {"status": "success", "message": "User Case saved"}
    raise HTTPException(status_code=500, detail="Failed to save User Case")

@app.get("/api/cases")
async def get_cases(uid: str):
    """
    Retrieves all formalized cases for a user.
    """
    cases = await run_in_threadpool(supabase_db.get_user_cases, uid)
    return {"status": "success", "cases": cases}


@app.get("/api/cases/session-forward")
async def get_session_forward(session_id: str):
    state = await run_in_threadpool(supabase_db.get_session_forward_state, session_id)
    return {"status": "success", "forward": state}


@app.post("/api/cases/follow-up")
async def add_case_followup(payload: CaseFollowupPayload):
    text = (payload.statement or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Statement is required")
    if payload.role not in ("moderator", "lawyer", "sahayak", "nodal_guide"):
        raise HTTPException(status_code=400, detail="Invalid forward role")
    state = await run_in_threadpool(
        supabase_db.append_case_followup,
        text,
        payload.role,
        payload.target_id,
        payload.case_id,
        payload.session_id,
        payload.user_id,
    )
    if not state:
        raise HTTPException(status_code=500, detail="Could not add follow-up")
    return {"status": "success", "forward": state}


@app.post("/api/cases/complete")
async def save_complete_case(payload: CaseCompletionPayload):
    """
    Saves a completed case with full situation summary and collected Q&A answers.
    Optionally generates and uploads PDF to Cloudinary.
    
    This endpoint should be called after the question_processor completes or if no questions were needed.
    Stores complete case context including user's language, location, and all collected information.
    """
    try:
        from backend.database.supabase_case_enhance import save_case_with_situation_summary, update_case_with_pdf

        print(
            "🧾 CASE_COMPLETE_REQUEST "
            f"case_id={payload.case_id} "
            f"session_id={payload.session_id} "
            f"uid={payload.uid} "
            f"generate_pdf={payload.generate_pdf} "
            f"has_pdf_url={bool(payload.pdf_url)} "
            f"answers_count={len(payload.collected_answers or {})} "
            f"summary_len={len(str((payload.structured_report or {}).get('summary', '')))}"
        )
        
        # Save the case with all details
        success = await run_in_threadpool(
            save_case_with_situation_summary,
            payload.uid,
            payload.case_id,
            payload.session_id,
            payload.structured_report,
            payload.situation_summary,
            payload.collected_answers,
            payload.session_data,
            pdf_url=payload.pdf_url,
            user_language=payload.user_language
        )
        
        if not success:
            print(f"❌ CASE_COMPLETE_SAVE_FAILED case_id={payload.case_id}")
            raise HTTPException(status_code=500, detail="Failed to save case")

        print(f"✅ CASE_COMPLETE_SAVED case_id={payload.case_id}")

        try:
            from backend.services.scam_case_classifier import embed_case_async

            embed_case_async(payload.case_id, payload.structured_report)
        except Exception as emb_err:  # noqa: BLE001
            print(f"⚠️ Could not start case embedding: {emb_err}")
        
        pdf_url = payload.pdf_url
        if payload.generate_pdf:
            # Generate and upload PDF
            try:
                pdf_result = generate_and_upload_report_pdf(
                    case_data={
                        **(payload.structured_report or {}),
                        "question_labels": (payload.situation_summary or {}).get("question_labels")
                        if isinstance(payload.situation_summary, dict)
                        else None,
                        "situation_summary": payload.situation_summary or {},
                    },
                    case_id=payload.case_id,
                    user_id=payload.uid,
                    answers=payload.collected_answers if payload.collected_answers else None,
                    question_labels=(payload.situation_summary or {}).get("question_labels")
                    if isinstance(payload.situation_summary, dict)
                    else None,
                )
                
                if pdf_result.get("success"):
                    source_pdf_url = pdf_result.get("url")
                    pdf_url = source_pdf_url
                    # Update case with PDF URL
                    await run_in_threadpool(
                        update_case_with_pdf,
                        payload.case_id,
                        pdf_url,
                        f"cases/{payload.case_id}",
                        user_id=payload.uid,
                        structured_report=payload.structured_report,
                    )
                    await run_in_threadpool(
                        supabase_db.update_pending_intervention_pdf,
                        payload.case_id,
                        pdf_url,
                        "moderator"
                    )
                    print(f"✅ PDF generated and uploaded: {source_pdf_url}")
                else:
                    print(f"⚠️ PDF generation failed: {pdf_result.get('error')}")
            except Exception as pdf_err:
                print(f"⚠️ Error generating PDF: {pdf_err}")
                # Don't fail the entire operation if PDF generation fails
        
        return {
            "status": "success",
            "case_id": payload.case_id,
            "pdf_url": pdf_url,
            "message": "Case completed and saved successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error saving complete case: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cases/{case_id}")
async def get_complete_case(case_id: str, user_id: str):
    """
    Retrieves complete case information including structured report, 
    situation summary, collected answers, and PDF URL.
    """
    try:
        from backend.database.supabase_case_enhance import get_case_complete
        
        case = await run_in_threadpool(get_case_complete, case_id)
        
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        
        # Verify user ownership
        if case.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Unauthorized access to case")
        
        return {
            "status": "success",
            "case": case
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error retrieving case: {e}")
        raise HTTPException(status_code=500, detail=str(e))
@app.post("/api/cases/{case_id}/generate-pdf")
async def generate_case_pdf_route(case_id: str, payload: CasePDFGenerationPayload):
    """
    On-demand PDF generation for a case (chat / my-cases re-download).
    """
    return await generate_case_pdf(
        case_id=case_id or payload.case_id,
        user_id=payload.user_id,
        answers=payload.collected_answers,
        structured_report=payload.structured_report,
    )


async def generate_case_pdf(
    case_id: str,
    user_id: str,
    answers: Optional[Dict[str, str]] = None,
    structured_report: Optional[Dict[str, Any]] = None,
):
    """
    Generate and upload PDF report for a case to Cloudinary.
    
    - Retrieves the case's structured_report from Supabase
    - Generates PDF from case data + optional answers to follow-up questions
    - Uploads to Cloudinary with folder structure: cases/{case_id}
    - Updates case's pdf_url in Supabase
    - Returns download URL
    """
    try:
        from backend.database.supabase_case_enhance import update_case_with_pdf

        case_data = structured_report
        if not case_data:
            # Fetch case from database
            cases = await run_in_threadpool(supabase_db.get_user_cases, user_id)
            for case in cases:
                if case.get("case_id") == case_id:
                    case_data = case.get("structured_report")
                    break

        if not case_data:
            # Fallback: direct lookup by id
            try:
                from backend.database.supabase_case_enhance import get_case_complete

                row = await run_in_threadpool(get_case_complete, case_id)
                if row and (not user_id or row.get("user_id") == user_id):
                    case_data = row.get("structured_report")
            except Exception:
                pass
        
        if not case_data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        # Generate and upload PDF
        result = generate_and_upload_report_pdf(
            case_data=case_data,
            case_id=case_id,
            user_id=user_id,
            answers=answers
        )
        
        if result.get("success"):
            direct_pdf_url = result.get("url")
            # Upsert case PDF URL (creates row if missing)
            await run_in_threadpool(
                update_case_with_pdf,
                case_id,
                direct_pdf_url,
                f"cases/{case_id}",
                user_id=user_id,
                structured_report=case_data,
            )
            await run_in_threadpool(supabase_db.update_pending_intervention_pdf, case_id, direct_pdf_url, "moderator")
            
            # Also add as attachment for future reference
            try:
                await run_in_threadpool(
                    supabase_db.add_case_attachment,
                    case_id,
                    direct_pdf_url,
                    "pdf",
                    f"case_report_{case_id}.pdf",
                    None,
                    user_id,
                )
            except Exception as att_err:  # noqa: BLE001
                print(f"⚠️ Could not add case attachment: {att_err}")
            
            return {
                "status": "success",
                "message": "PDF generated and uploaded successfully",
                "pdf_url": direct_pdf_url,
                "public_id": result.get("public_id")
            }
        else:
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {result.get('error')}")
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating case PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cases/{case_id}/pdf")
async def get_case_pdf(case_id: str):
    """
    Redirects to the exact stored case PDF URL.
    """
    try:
        pdf_url = await run_in_threadpool(supabase_db.get_case_pdf_url, case_id)
        if isinstance(pdf_url, str) and ".pdf.pdf" in pdf_url:
            pdf_url = pdf_url.replace(".pdf.pdf", ".pdf")

        internal_path = f"/api/cases/{case_id}/pdf"
        internal_abs = f"http://localhost:8000{internal_path}"
        if isinstance(pdf_url, str):
            normalized = pdf_url.strip()
            if normalized in {internal_path, internal_abs}:
                pdf_url = None

        if not pdf_url:
            raise HTTPException(status_code=404, detail="PDF has not been generated yet")

        return RedirectResponse(url=pdf_url, status_code=307)
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error retrieving case PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/interventions/{collection_name}")
async def get_interventions(collection_name: str, notified_uid: Optional[str] = None):
    """
    Pending interventions for a team. Pass notified_uid to only return cases
    this moderator was push-notified about (reconnect catch-up).
    """
    cases = await run_in_threadpool(
        supabase_db.get_pending_interventions, collection_name, notified_uid
    )
    return {"status": "success", "cases": cases}

import json

@app.websocket("/ws/user/{uid}")
async def websocket_user_endpoint(websocket: WebSocket, uid: str):
    await manager.connect(websocket, channel=uid)
    try:
        while True:
            # Keep connection alive — incoming messages are ignored
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel=uid)
    except Exception as e:
        # Catch ALL other exceptions to prevent silent crashes
        print(f"⚠️ WebSocket error for uid '{uid}': {e}")
        manager.disconnect(websocket, channel=uid)


from fastapi import Request

@app.post("/api/webhooks/supabase/interventions")
async def supabase_webhook_interventions(request: Request):
    """
    Webhook receiver from Supabase for changes to the interventions table.
    """
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return {"status": "error", "message": "Invalid JSON payload"}

    table = payload.get("table")
    action_type = payload.get("type")
    record = payload.get("record", {})
    
    if table == "interventions":
        if action_type == "INSERT":
            # Safely parse structured_report — it may be dict, string, or None
            s_report = record.get("structured_report") or {}
            if isinstance(s_report, str):
                try:
                    import json as _json
                    s_report = _json.loads(s_report)
                except Exception:
                    s_report = {}

            case_data = {
                "type": "new_intervention",
                "case_id": record.get("id"),
                "user_id": record.get("user_id"),
                "incident_type": s_report.get("incident_type", "Unknown"),
                "risk_level": s_report.get("risk_level", "High"),
                "structured_report": s_report,
                "timestamp": record.get("created_at"),
                "collection": record.get("collection_name") or "moderator",
                "status": record.get("status", "pending"),
                "session_id": record.get("session_id"),
                "user_statement": record.get("user_statement") or "",
                "location": record.get("location") or {},
                "pdf_url": s_report.get("pdf_url"),
                "routing_recommendation": supabase_db.get_intervention_routing_recommendation(
                    s_report,
                    record.get("user_statement") or "",
                    record.get("location") or {},
                ),
            }

            try:
                from dateutil import parser
                dt = parser.parse(record.get("created_at"))
                case_data["timestamp"] = int(dt.timestamp() * 1000)
            except Exception:
                import time
                case_data["timestamp"] = int(time.time() * 1000)

            # Route through dispatcher (ranked top-3 online moderators)
            recipients = await run_in_threadpool(
                case_dispatcher.dispatch_intervention,
                case_id=record.get("id"),
                user_id=record.get("user_id"),
                structured_report=s_report,
                collection_name=record.get("collection_name") or "moderator",
                session_id=record.get("session_id"),
                user_statement=record.get("user_statement") or "",
                location=record.get("location") or {},
                created_at=record.get("created_at"),
            )
            print(f"📢 Dispatched new_intervention to {recipients}: case {record.get('id')}")
            return {"status": "success", "message": "Dispatched new intervention to moderators"}

        elif action_type == "UPDATE":
            # Broadcast updates to moderator queue so dashboard stays in sync without reload.
            s_report = record.get("structured_report") or {}
            if isinstance(s_report, str):
                try:
                    import json as _json
                    s_report = _json.loads(s_report)
                except Exception:
                    s_report = {}

            moderator_update = {
                "type": "intervention_updated",
                "case_id": record.get("id"),
                "user_id": record.get("user_id"),
                "incident_type": s_report.get("incident_type", "Unknown"),
                "risk_level": s_report.get("risk_level", "High"),
                "structured_report": s_report,
                "timestamp": record.get("updated_at") or record.get("created_at"),
                "collection": record.get("collection_name") or "moderator",
                "status": record.get("status", "pending"),
                "session_id": record.get("session_id"),
                "user_statement": record.get("user_statement") or "",
                "location": record.get("location") or {},
                "pdf_url": s_report.get("pdf_url"),
                "routing_recommendation": supabase_db.get_intervention_routing_recommendation(
                    s_report,
                    record.get("user_statement") or "",
                    record.get("location") or {},
                ),
            }
            await manager.broadcast(json.dumps(moderator_update), channel="moderator")

            # Broadcast status updates/resolutions directly to the specific user
            if record.get("status") in ["reviewed", "resolved"]:
                routing_from_options = None
                raw_opts = record.get("moderator_options")
                if isinstance(raw_opts, list):
                    for opt in raw_opts:
                        if isinstance(opt, dict) and opt.get("type") == "routing_bundle" and isinstance(opt.get("routing_recommendation"), dict):
                            routing_from_options = opt.get("routing_recommendation")
                            break
                update_data = {
                    "type": "intervention_resolved",
                    "case_id": record.get("id"),
                    "moderator_response": record.get("moderator_response"),
                    "moderator_options": record.get("moderator_options"),
                    "status": record.get("status"),
                    "session_id": record.get("session_id"),
                    "routing_recommendation": routing_from_options,
                }
                user_id = record.get("user_id")
                if user_id:
                    await manager.broadcast(json.dumps(update_data), channel=user_id)

                # Also notify all moderator clients to remove this case from queue.
                await manager.broadcast(json.dumps({
                    "type": "intervention_resolved",
                    "case_id": record.get("id"),
                    "status": record.get("status"),
                    "collection": record.get("collection_name") or "moderator"
                }), channel="moderator")
                return {"status": "success", "message": f"Broadcasted resolution to user {user_id}"}

    return {"status": "ignored"}


class ResolveInterventionPayload(BaseModel):
    case_id: str
    moderator_response: str
    moderator_options: list
    routing_recommendation: Optional[Dict[str, Any]] = None
    moderator_id: Optional[str] = None
    moderator_summary: Optional[str] = None
    moderator_notes: Optional[str] = None
    moderator_report: Optional[Dict[str, Any]] = None
    moderator_suggested_links: Optional[list] = None
    review_outcome: Optional[str] = None
    nyayguide_support_needed: Optional[bool] = None
    nyayguide_assistance_type: Optional[str] = None

@app.post("/api/interventions/resolve")
async def resolve_intervention(payload: ResolveInterventionPayload):
    """
    Resolves a pending intervention case by adding the moderator's text and options.
    After updating the DB, directly broadcasts the resolution to the user via WebSocket
    so the user sees the response immediately without relying solely on the Supabase webhook.
    """
    result = await run_in_threadpool(
        lambda: supabase_db.resolve_intervention_case(
            payload.case_id,
            payload.moderator_response,
            payload.moderator_options,
            payload.routing_recommendation,
            payload.moderator_id,
            payload.moderator_summary,
            payload.moderator_notes,
            payload.moderator_report,
            payload.moderator_suggested_links,
            review_outcome=payload.review_outcome,
            nyayguide_support_needed=payload.nyayguide_support_needed,
            nyayguide_assistance_type=payload.nyayguide_assistance_type,
        )
    )
    if result and result.get("success"):
        user_id = result.get("user_id")
        snapshot = result.get("case_snapshot") or {}
        update_data = {
            "type": "intervention_resolved",
            "case_id": result.get("case_id"),
            "session_id": result.get("session_id"),
            "moderator_response": result.get("moderator_response"),
            "moderator_options": result.get("moderator_options"),
            "status": "reviewed",
            "routing_recommendation": result.get("routing_recommendation"),
        }
        if snapshot:
            update_data.update({
                "structured_report": snapshot.get("structured_report"),
                "ai_verification_status": snapshot.get("ai_verification_status"),
                "nyayguide_support_needed": snapshot.get("nyayguide_support_needed"),
                "suggested_actions": snapshot.get("suggested_actions") or [],
                "workflow_state": snapshot.get("workflow_state"),
                "version": snapshot.get("version"),
            })
        if user_id:
            update_data = {
                "type": "intervention_resolved",
                "case_id": result.get("case_id"),
                "session_id": result.get("session_id"),
                "moderator_response": result.get("moderator_response"),
                "moderator_options": result.get("moderator_options"),
                "status": "reviewed",
                "routing_recommendation": result.get("routing_recommendation"),
            }
            await manager.broadcast(json.dumps(update_data), channel=user_id)
            print(f"Broadcasted intervention_resolved directly to user WS channel '{user_id}'")
        # Drop from other notified moderators' queues
        await run_in_threadpool(
            case_dispatcher.notify_intervention_claimed,
            payload.case_id,
            payload.moderator_id or "",
            None,
        )
        return {"status": "success", "message": "Intervention resolved and user notified"}
    raise HTTPException(status_code=500, detail="Failed to resolve intervention")

class LawyerRegistrationPayload(BaseModel):
    uid: str
    name: str
    specialization: str = ""
    lawyerType: str = "Private Practice (PVT)"
    experience: int = 0
    hourlyRate: int = 0
    bio: str = ""
    about: Optional[str] = None
    headline: Optional[str] = None
    location: str = ""
    city: Optional[str] = None
    state: Optional[str] = None
    avatar: str = "https://images.unsplash.com/photo-1556157382-97dee2dcb9d9?q=80&w=2670&auto=format&fit=crop"
    coverImage: Optional[str] = None
    barRegistrationNumber: str = ""
    contactNumber: str = ""
    email: str = ""
    practiceAreas: Optional[List[str]] = None
    courtsPracticed: Optional[List[str]] = None
    languages: Optional[List[str]] = None
    availabilityHours: Optional[str] = None
    consultationModes: Optional[List[str]] = None
    websiteUrl: Optional[str] = None
    linkedinUrl: Optional[str] = None
    profileExtras: Optional[Dict[str, Any]] = None

@app.post("/api/lawyers/register")
async def register_lawyer(payload: LawyerRegistrationPayload):
    """
    Saves lawyer professional details to Supabase and indexes in Vector DB.
    """
    try:
        data = payload.dict()
        uid = data.pop('uid')
        if not data.get("specialization") and data.get("practiceAreas"):
            data["specialization"] = data["practiceAreas"][0]
        if not data.get("about"):
            data["about"] = data.get("bio") or ""
        
        # 1. Upsert into Supabase public "lawyers" directory
        await run_in_threadpool(supabase_db.register_lawyer_directory, uid, data)
        
        # 2. Update Postgres pgvector embedding for semantic search
        from backend.database.vector_db import VectorDB
        vdb = VectorDB()
        embed_bio = data.get("about") or payload.bio or payload.headline or ""
        vdb.add_lawyer(
            lawyer_id=uid,
            bio=embed_bio,
            metadata={
                "name": payload.name,
                "specialization": data.get("specialization") or payload.specialization,
                "lawyerType": payload.lawyerType,
                "experience": payload.experience,
                "hourlyRate": payload.hourlyRate,
                "location": payload.location
            }
        )
        
        return {"status": "success", "message": "Lawyer profile registered and indexed successfully"}
    except Exception as e:
        print(f"Error registering lawyer details: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save lawyer details: {str(e)}")

class LawyerSearchQuery(BaseModel):
    query: str
    top_k: int = 5
    filters: Optional[Dict[str, Any]] = None

@app.post("/api/lawyers/search")
async def search_lawyers_endpoint(payload: LawyerSearchQuery):
    """
    Performs vector search for lawyers and returns enriched Firestore data.
    """
    try:
        from backend.database.vector_db import VectorDB
        vector_db_inst = VectorDB()
        
        # 1. Get relevant lawyer IDs from Vector DB
        lawyer_ids = vector_db_inst.search_lawyers(payload.query, top_k=payload.top_k, filters=payload.filters)
        
        if not lawyer_ids:
            return {"status": "success", "lawyers": []}
            
        # 2. Fetch full details from Supabase directory
        lawyers = await run_in_threadpool(supabase_db.get_lawyers_by_ids, lawyer_ids)
        
        return {"status": "success", "lawyers": lawyers}
    except Exception as e:
        print(f"Error in lawyer search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lawyers")
async def get_lawyers():
    """
    Returns a list of all users with the 'lawyer' role.
    """
    lawyers = await run_in_threadpool(supabase_db.search_lawyers)
    # In a real app we'd fetch their professional_details too, but Pyrebase returns the whole node if configured
    return {"status": "success", "lawyers": lawyers}


# ---------------------------------------------------------------------------
# Knowledge-base articles + semantic search (powers HeroSearch -> /search -> /blogs)
# ---------------------------------------------------------------------------

@app.get("/api/articles")
async def get_articles(
    limit: int = 24,
    offset: int = 0,
    category: Optional[str] = None,
    diverse: bool = False,
):
    """Paginated list of published legal articles (no embeddings in payload).

    ``diverse=true`` returns one latest article per category (for landing cards).
    """
    try:
        if diverse:
            items = await run_in_threadpool(supabase_db.list_articles_diverse, limit)
            return {"status": "success", "articles": items, "total": len(items), "limit": limit, "offset": 0}
        items = await run_in_threadpool(supabase_db.list_articles, limit, offset, category)
        total = await run_in_threadpool(supabase_db.count_articles, category)
        return {"status": "success", "articles": items, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        print(f"Error listing articles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ArticleSearchQuery(BaseModel):
    query: str
    top_k: int = 12
    category: Optional[str] = None


@app.post("/api/articles/search")
async def search_articles_endpoint(payload: ArticleSearchQuery):
    """Semantic (pgvector) search over articles; returns ranked preview cards."""
    try:
        query = (payload.query or "").strip()
        if not query:
            return {"status": "success", "articles": [], "query": query}
        vector_db_inst = vdb.VectorDB()
        results = await run_in_threadpool(
            vector_db_inst.search_articles, query, payload.top_k, payload.category
        )
        return {"status": "success", "articles": results, "query": query}
    except Exception as e:
        print(f"Error in article search: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/articles/{article_id}")
async def get_article_endpoint(article_id: str):
    """Full article detail for /blogs/[id]."""
    try:
        article = await run_in_threadpool(supabase_db.get_article, article_id)
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")
        return {"status": "success", "article": article}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching article: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Sidebar section content: legal rights, documents, file-a-case, site content
# ---------------------------------------------------------------------------

@app.get("/api/legal-rights")
async def get_legal_rights():
    try:
        items = await run_in_threadpool(supabase_db.list_legal_rights)
        return {"status": "success", "rights": items}
    except Exception as e:
        print(f"Error listing legal rights: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/documents")
async def get_document_templates(category: Optional[str] = None):
    try:
        items = await run_in_threadpool(supabase_db.list_document_templates, category)
        return {"status": "success", "documents": items}
    except Exception as e:
        print(f"Error listing document templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/file-case/templates")
async def get_case_filing_templates(category: Optional[str] = None):
    try:
        items = await run_in_threadpool(supabase_db.list_case_filing_templates, category)
        return {"status": "success", "templates": items}
    except Exception as e:
        print(f"Error listing case filing templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/file-case/templates/{template_id}")
async def get_case_filing_template(template_id: str):
    try:
        item = await run_in_threadpool(supabase_db.get_case_filing_template, template_id)
        if not item:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"status": "success", "template": item}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching case filing template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/content/{slug}")
async def get_content(slug: str):
    try:
        row = await run_in_threadpool(supabase_db.get_site_content, slug)
        if not row:
            raise HTTPException(status_code=404, detail="Content not found")
        return {"status": "success", "content": row.get("value") if isinstance(row, dict) else row}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching site content: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lawyer/profile/{uid}")
async def get_lawyer_profile_endpoint(uid: str):
    """
    Fetches the lawyer profile details by user ID from Supabase.
    """
    try:
        profile = await run_in_threadpool(supabase_db.get_lawyer_profile, uid)
        if profile:
            return {"status": "success", "profile": profile}
        else:
            raise HTTPException(status_code=404, detail="Lawyer profile not found")
    except Exception as e:
        print(f"Error fetching lawyer profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class LawyerProfileUpdatePayload(BaseModel):
    name: Optional[str] = None
    specialization: Optional[str] = None
    lawyerType: Optional[str] = None
    experience: Optional[int] = None
    hourlyRate: Optional[int] = None
    bio: Optional[str] = None
    about: Optional[str] = None
    headline: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    avatar: Optional[str] = None
    coverImage: Optional[str] = None
    barRegistrationNumber: Optional[str] = None
    contactNumber: Optional[str] = None
    practiceAreas: Optional[List[str]] = None
    courtsPracticed: Optional[List[str]] = None
    languages: Optional[List[str]] = None
    availabilityHours: Optional[str] = None
    consultationModes: Optional[List[str]] = None
    websiteUrl: Optional[str] = None
    linkedinUrl: Optional[str] = None
    profileExtras: Optional[Dict[str, Any]] = None

@app.put("/api/lawyer/profile/{uid}")
async def update_lawyer_profile_endpoint(uid: str, payload: LawyerProfileUpdatePayload):
    """
    Updates the lawyer profile details in Supabase.
    """
    try:
        update_data = {k: v for k, v in payload.dict().items() if v is not None}
        if not update_data:
            return {"status": "success", "message": "No data to update"}

        updated_profile = await run_in_threadpool(supabase_db.update_lawyer_profile, uid, update_data)
        
        if updated_profile:
            return {"status": "success", "profile": updated_profile, "message": "Profile updated successfully"}
        else:
            raise HTTPException(status_code=404, detail="Failed to update lawyer profile")
    except Exception as e:
        print(f"Error updating lawyer profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lawyer/cases/{uid}")
async def get_lawyer_cases_endpoint(uid: str):
    """
    Fetches pending and assigned cases for a lawyer.
    """
    try:
        cases = await run_in_threadpool(supabase_db.get_lawyer_cases, uid)
        counts = await run_in_threadpool(supabase_db.count_lawyer_cases_for_lawyer, uid)
        return {"status": "success", "cases": cases, "counts": counts}
    except Exception as e:
        print(f"Error fetching lawyer cases: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class AcceptCasePayload(BaseModel):
    lawyer_id: str

@app.post("/api/lawyer/cases/{case_id}/accept")
async def accept_lawyer_case_endpoint(case_id: str, payload: AcceptCasePayload):
    """
    Lawyer accepts a pending case.
    """
    try:
        success = await run_in_threadpool(supabase_db.accept_lawyer_case, case_id, payload.lawyer_id)
        if success:
            return {"status": "success", "message": "Case accepted"}
        else:
            raise HTTPException(status_code=400, detail="Failed to accept case")
    except Exception as e:
        print(f"Error accepting lawyer case: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ─── Sahayak Endpoints ────────────────────────────────────────

@app.get("/api/sahayak/session-case")
async def get_sahayak_case_for_session(session_id: str):
    """
    Returns the sahayak case associated with a chat session, including
    the assigned guide's profile if accepted. Used to restore the panel on history load.
    """
    case = await run_in_threadpool(supabase_db.get_sahayak_case_by_session, session_id)
    if case:
        return {"status": "success", "case": case}
    return {"status": "not_found", "case": None}

@app.get("/api/sahayak/profile/{uid}")
async def get_sahayak_profile_endpoint(uid: str):
    """Fetch a Nyay Guide's profile."""
    try:
        profile = await run_in_threadpool(supabase_db.get_sahayak_profile, uid)
        return {"status": "success", "profile": profile}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SahayakProfilePayload(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    contactNumber: Optional[str] = None
    location: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    occupation: Optional[str] = None
    bio: Optional[str] = None
    avatar: Optional[str] = None
    languages: Optional[List[str]] = None
    availability: Optional[str] = None

@app.post("/api/sahayak/profile/{uid}")
async def upsert_sahayak_profile_endpoint(uid: str, payload: SahayakProfilePayload):
    """Create or update a Nyay Guide's profile."""
    try:
        data = {k: v for k, v in payload.dict().items() if v is not None}
        success = await run_in_threadpool(supabase_db.upsert_sahayak_profile, uid, data)
        if success:
            return {"status": "success", "message": "Profile saved"}
        raise HTTPException(status_code=400, detail="Failed to save profile")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sahayak/profiles")
async def get_all_sahayak_profiles_endpoint():
    """Returns all Nyay Guide profiles (for victim browsing)."""
    try:
        profiles = await run_in_threadpool(supabase_db.get_all_sahayak_profiles)
        return {"status": "success", "profiles": profiles}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sahayak/cases/{uid}")
async def get_sahayak_cases_endpoint(uid: str):
    """Fetch pending and assigned cases for a Nyay Guide."""
    try:
        cases = await run_in_threadpool(supabase_db.get_sahayak_cases, uid)
        return {"status": "success", "cases": cases}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class AcceptSahayakCasePayload(BaseModel):
    sahayak_id: str
    sahayak_name: Optional[str] = ""

@app.post("/api/sahayak/cases/{case_id}/accept")
async def accept_sahayak_case_endpoint(case_id: str, payload: AcceptSahayakCasePayload):
    """Sahayak accepts a pending case."""
    try:
        meta = None
        if hasattr(supabase_db, "accept_sahayak_case_with_meta"):
            meta = await run_in_threadpool(
                supabase_db.accept_sahayak_case_with_meta,
                case_id,
                payload.sahayak_id,
                payload.sahayak_name or "",
            )
            success = bool(meta)
        else:
            success = await run_in_threadpool(
                supabase_db.accept_sahayak_case,
                case_id,
                payload.sahayak_id,
                payload.sahayak_name or "",
            )
        if success:
            notified = list((meta or {}).get("notified_user_ids") or [])
            await run_in_threadpool(
                case_dispatcher.notify_sahayak_case_claimed,
                case_id,
                payload.sahayak_id,
                notified,
            )
            return {"status": "success", "message": "Case accepted"}
        raise HTTPException(status_code=400, detail="Failed to accept case")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DeclineSahayakCasePayload(BaseModel):
    sahayak_id: str


@app.post("/api/sahayak/cases/{case_id}/decline")
async def decline_sahayak_case_endpoint(case_id: str, payload: DeclineSahayakCasePayload):
    """Sahayak declines a pending case — removes it from their help queue."""
    try:
        success = await run_in_threadpool(
            supabase_db.decline_sahayak_case,
            case_id,
            payload.sahayak_id,
        )
        if success:
            return {"status": "success", "message": "Case declined"}
        raise HTTPException(status_code=400, detail="Failed to decline case")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- New Agentic Endpoints ---


from fastapi import UploadFile, File, Form
from fastapi.responses import StreamingResponse
import json
import asyncio
import time

# ... (transcribe_endpoint omitted for brevity, logic remains same)

import re as _re

# All known agent name patterns to strip from streamed answer tokens
_AGENT_PREFIX_RE = _re.compile(
    r'^(?:(?:civil|cyber|criminal|domestic|scam|document|sahayak|legal[_ ]?moderator|lawyer[_ ]?forwarder|supervisor|assistant|ai)[\s_]?agent[:\s]*|(?:civil|cyber|criminal|domestic|scam|document|sahayak|assistant)[:\s]+)',
    _re.IGNORECASE
)

def _strip_agent_prefix(text: str) -> str:
    """Strip leading agent-name prefixes from a streaming token or accumulated text."""
    return strip_classification_block(_AGENT_PREFIX_RE.sub('', text, count=1).lstrip())


_ROUTING_ONLY_TOKENS = {
    "clarify",
    "cyber",
    "criminal",
    "civil",
    "domestic",
    "scam",
    "document",
    "finance",
    "sahayak",
    "legal_moderator",
    "lawyer_forwarder",
    "question_processor",
    "plan_runner",
    "supervisor",
}


def _is_routing_only_text(text: Any) -> bool:
    token = str(text or "").strip().lower().strip(".,:;")
    return bool(token) and token in _ROUTING_ONLY_TOKENS


def _graph_node_id(event: dict) -> str:
    meta = event.get("metadata") or {}
    node = str(meta.get("langgraph_node") or "").strip()
    name = str(event.get("name") or "").strip()
    return node or name


def _is_graph_node_boundary(event: dict) -> bool:
    meta = event.get("metadata") or {}
    lg = str(meta.get("langgraph_node") or "").strip()
    name = str(event.get("name") or "").strip()
    if lg:
        return name == lg
    return name in {
        "supervisor",
        "plan_runner",
        "scam_match",
        "cyber",
        "criminal",
        "civil",
        "domestic",
        "scam",
        "document",
        "finance",
        "sahayak",
        "legal_moderator",
        "lawyer_forwarder",
        "question_processor",
        "report_generator",
        "suggested_actions",
        "nodal_guide",
        "sexual_offense",
    }


def _chain_output_dict(event: dict) -> dict:
    data = event.get("data") or {}
    output = data.get("output")
    if isinstance(output, dict):
        return output
    values = getattr(output, "values", None)
    if isinstance(values, dict):
        return values
    try:
        if output is not None:
            return dict(output)
    except Exception:
        pass
    return {}

# Dynamic stream allowlist derived from compiled graph topology.
# Falls back to the historical specialist set if introspection fails.
_FALLBACK_USER_FACING_STREAM_NODES = {
    "cyber",
    "criminal",
    "civil",
    "domestic",
    "scam",
    "finance",
    "sexual_offense",
}


def _user_facing_stream_nodes() -> set[str]:
    try:
        from backend.services.graph_registry import user_facing_stream_nodes

        nodes = user_facing_stream_nodes("chat_agent")
        # Keep specialist-style streaming; still exclude pure handoff panels if desired.
        # Prefer intersection with known content producers when available.
        if nodes:
            return nodes
    except Exception as e:
        print(f"⚠️ Dynamic stream node discovery failed: {e}")
    return set(_FALLBACK_USER_FACING_STREAM_NODES)


USER_FACING_STREAM_NODES = _user_facing_stream_nodes()

@app.post("/chat/stream")
async def chat_stream(user_query: UserQuery):
    """
    Streams the agent graph execution events to the frontend in NDJSON format.
    Enhanced error handling to prevent HTML responses being treated as JSON.
    """
    async def event_stream():
        # First bytes immediately so an empty 200 cannot be confused with a hung/stolen port.
        yield json.dumps({"type": "log", "agent": "System", "content": "Stream connected."}) + "\n"
        try:
            print(f"STREAMING QUERY: {user_query.query}")
            if user_query.location:
                print(f"Location: {user_query.location}")
        except Exception:
            pass

        latest_case_context: Dict[str, Any] = {
            "case_id": None,
            "structured_report": None,
            "suggested_actions": [],
            "situation_summary": {},
            "collected_answers": {},
            "question_labels": {},
            "user_language": "english",
            "intervention_required": False,
            "routing_recommendation": None,
            "show_routing_consent": False,
        }

        # Build smart compressed history for context.
        # Strategy: user messages verbatim (short), assistant replies = first sentence only (~100 chars).
        # All injected as a single SystemMessage "chat summary" to avoid bloating the context window.
        from langchain_core.messages import AIMessage, SystemMessage as LCSystemMessage

        def _compress_assistant(text_in: Any, max_chars: int = 120) -> str:
            """Extract first meaningful sentence from an assistant reply, strip markdown."""
            import re
            text = str(text_in) if text_in is not None else ""
            # Strip markdown bold/italic/headings/links
            text = re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', text)  # bold/italic
            text = re.sub(r'#+\s*', '', text)  # headings
            text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)  # links
            text = re.sub(r'`[^`]*`', '', text)  # inline code
            text = text.strip()
            # Take up to first sentence boundary within max_chars
            for sep in ['. ', '.\n', '! ', '? ', '\n\n']:
                idx = text.find(sep)
                if 0 < idx <= max_chars:
                    return text[0:idx + 1].strip()  # type: ignore # Pyre doesn't understand string slice types
            if len(text) > max_chars:
                return text[:max_chars].rsplit(' ', 1)[0].strip() + '...'  # type: ignore # Pyre doesn't understand string slice types
            return text

        history_messages = []
        history_list: List[Dict[str, Any]] = user_query.session_history or []
        thread_id = user_query.session_id or user_query.user_id
        has_checkpoint = False
        try:
            from backend.database.graph_checkpointer import thread_has_checkpoint

            has_checkpoint = bool(thread_id) and thread_has_checkpoint(str(thread_id))
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ checkpoint lookup skipped: {exc}")

        if (not has_checkpoint) and len(history_list) >= 2:
            summary_lines: List[str] = []
            # Slice manually if linter complains about list slicing
            num_msgs = len(history_list)
            start_idx = max(0, num_msgs - 8)
            last_msgs = [history_list[i] for i in range(start_idx, num_msgs)]
            for msg in last_msgs: 
                role = msg.get("role", "user")
                content = msg.get("content", "").strip()
                if not content:
                    continue
                if role == "user":
                    summary_lines.append(f"User: {content}")
                elif role == "assistant":
                    summary_lines.append(f"Assistant (summary): {_compress_assistant(content)}")

            if summary_lines:
                summary_text = "The following is a compressed summary of the conversation so far. Use it only to maintain context for the current user query.\n\n" + "\n".join(summary_lines)
                history_messages = [LCSystemMessage(content=summary_text)]

        inputs = {
            "messages": history_messages + [HumanMessage(content=user_query.query)],
            "user_details": {
                "user_id": user_query.user_id,
                "location": user_query.location,
                "session_id": user_query.session_id,
                "query": user_query.query,
                "attachments": user_query.attachments or [],
            },
            "user_id": user_query.user_id or "",
            "user_name": user_query.user_name or "User",
            "session_id": user_query.session_id or "",
            "attachments": user_query.attachments or [],
        }

        # Use session_id as thread if provided, else fall back to user_id
        thread_id = user_query.session_id or user_query.user_id
        
        # Accumulate streamed answer to strip prefix from start of full response
        accumulated_answer: str = ""
        prefix_stripped: bool = False
        answer_yielded: bool = False
        wrap_up_yielded: bool = False
        generated_pdf_cases: set[str] = set()
        # Specialists that answer via LLM tokens; also keep final_response as a
        # production fallback when proxies drop/buffer token events.
        _content_specialists = {
            "cyber",
            "criminal",
            "civil",
            "domestic",
            "scam",
            "document",
            "finance",
            "sexual_offense",
            "legal_moderator",
            "lawyer_forwarder",
            "sahayak",
            "nodal_guide",
            "supervisor",
        }
        _internal_nodes = {
            "report_generator",
            "plan_runner",
            "suggested_actions",
            "scam_match",
        }

        def _yield_answer(text: Any):
            nonlocal answer_yielded
            content = text if isinstance(text, str) else ("" if text is None else str(text))
            if not str(content).strip() or _is_routing_only_text(content):
                return None
            answer_yielded = True
            return json.dumps({"type": "answer", "content": content}) + "\n"

        def _iter_answer_pieces(text: str, target_len: int = 24) -> list[str]:
            """Split text into word-biased pieces for incremental UI streaming."""
            if not text:
                return []
            pieces: list[str] = []
            buf = ""
            for word in text.split(" "):
                candidate = f"{buf} {word}".strip() if buf else word
                if len(candidate) >= target_len and buf:
                    pieces.append(buf + " ")
                    buf = word
                else:
                    buf = candidate
            if buf:
                pieces.append(buf)
            return pieces or [text]

        async def _emit_answer_chunks(text: Any, *, delay_s: float = 0.02, force: bool = False):
            """Emit incremental answer events when the LLM did not stream tokens."""
            nonlocal answer_yielded
            content = text if isinstance(text, str) else ("" if text is None else str(text))
            if not str(content).strip():
                return
            if answer_yielded and not force:
                return
            for piece in _iter_answer_pieces(content):
                line = _yield_answer(piece)
                if line:
                    yield line
                    await asyncio.sleep(delay_s)
        
        try:
            # Stream events from the graph
            config = {"configurable": {"thread_id": thread_id}}
            async for event in agent_graph.astream_events(inputs, config=config, version="v2"):
                try:
                    kind = event["event"]
                    raw_name = event.get("name") or ""
                    node_id = _graph_node_id(event)
                    boundary = _is_graph_node_boundary(event)
                    name = node_id if boundary else raw_name
                    
                    # Filter out uninteresting events
                    if kind == "on_chain_start":
                        if not boundary or name in {"Agent", "__start__", "__end__", "START", "END"}:
                            continue
                        
                        # Notify frontend about active agent
                        if name in ["cyber", "criminal", "civil", "domestic", "scam", "document", "finance", "sahayak", "legal_moderator", "lawyer_forwarder", "question_processor", "sexual_offense"]:
                            yield json.dumps({"type": "agent_start", "agent": name}) + "\n"
                            accumulated_answer = ""
                            prefix_stripped = False
                            
                            if name == "question_processor":
                                async for line in _emit_answer_chunks("*(Formulating follow-up questions...)*\n\n", force=True):
                                    yield line

                        elif name in ["report_generator", "plan_runner", "suggested_actions", "supervisor"]:
                            yield json.dumps({"type": "agent_start", "agent": name}) + "\n"
                            
                            if name == "report_generator":
                                async for line in _emit_answer_chunks("*(Analyzing incident details...)*\n\n", force=True):
                                    yield line

                        yield json.dumps({"type": "log", "agent": "System", "content": f"Starting {name}..."}) + "\n"
                    
                    elif kind == "on_chain_end":
                        if not boundary:
                            continue
                        output = _chain_output_dict(event)
                        # Supervisor may end the turn with a static clarify reply (no specialist stream).
                        if name == "supervisor":
                            step = str(output.get("next_step") or "").lower()
                            ends_turn = step in {"", "end", "__end__"}
                            if output.get("final_response") and not answer_yielded and ends_turn:
                                async for line in _emit_answer_chunks(output.get("final_response")):
                                    yield line

                        # Specialist LLM nodes: if token stream was empty/dropped, emit final_response.
                        if name in _content_specialists and name != "supervisor":
                            visible = strip_classification_block(
                                str(output.get("chat_text") or output.get("final_response") or "")
                            )
                            if visible and not answer_yielded:
                                clean = _strip_agent_prefix(visible)
                                async for line in _emit_answer_chunks(clean):
                                    yield line

                        if name in ["report_generator", "suggested_actions", "legal_moderator", "sahayak", "lawyer_forwarder", "question_processor", "nodal_guide", "sexual_offense", "scam_match", "scam"]:
                            if output:
                                latest_case_context["case_id"] = output.get("case_id") or latest_case_context.get("case_id")
                                latest_case_context["structured_report"] = output.get("structured_report") or latest_case_context.get("structured_report")
                                latest_case_context["suggested_actions"] = output.get("suggested_actions") or latest_case_context.get("suggested_actions") or []
                                latest_case_context["suggested_links"] = output.get("suggested_links") or latest_case_context.get("suggested_links") or []
                                latest_case_context["situation_summary"] = output.get("situation_summary") or latest_case_context.get("situation_summary") or {}
                                latest_case_context["collected_answers"] = output.get("collected_answers") or latest_case_context.get("collected_answers") or {}
                                if output.get("question_labels"):
                                    latest_case_context["question_labels"] = output.get("question_labels")
                                elif isinstance(output.get("situation_summary"), dict) and output["situation_summary"].get("question_labels"):
                                    latest_case_context["question_labels"] = output["situation_summary"]["question_labels"]
                                latest_case_context["user_language"] = output.get("user_language") or latest_case_context.get("user_language") or "english"
                                latest_case_context["intervention_required"] = bool(output.get("intervention_required", latest_case_context.get("intervention_required", False)))
                                latest_case_context["routing_recommendation"] = output.get("routing_recommendation") or latest_case_context.get("routing_recommendation")
                                latest_case_context["show_routing_consent"] = bool(output.get("show_routing_consent", latest_case_context.get("show_routing_consent", False)))
                                latest_case_context["female_nyayguide_profiles"] = output.get("female_nyayguide_profiles") or latest_case_context.get("female_nyayguide_profiles") or []
                                latest_case_context["show_female_nyayguide_panel"] = bool(output.get("show_female_nyayguide_panel", latest_case_context.get("show_female_nyayguide_panel", False)))
                                latest_case_context["female_lawyer_profiles"] = output.get("female_lawyer_profiles") or latest_case_context.get("female_lawyer_profiles") or []
                                latest_case_context["show_female_lawyer_panel"] = bool(output.get("show_female_lawyer_panel", latest_case_context.get("show_female_lawyer_panel", False)))
                                latest_case_context["agent_plan"] = output.get("agent_plan") or latest_case_context.get("agent_plan")
                                latest_case_context["phase"] = output.get("phase") or latest_case_context.get("phase")
                                if output.get("matched_scam_trends"):
                                    latest_case_context["matched_scam_trends"] = output.get("matched_scam_trends")
                                if output.get("scam_similarity_note"):
                                    latest_case_context["scam_similarity_note"] = output.get("scam_similarity_note")

                                if name in ("report_generator", "suggested_actions"):
                                    delta = strip_classification_block(output.get("user_facing_delta") or "")
                                    if name == "report_generator" and delta and not answer_yielded:
                                        async for line in _emit_answer_chunks(delta):
                                            yield line
                                    if name == "suggested_actions" and delta:
                                        wrap_up_yielded = True
                                        yield json.dumps({"type": "wrap_up", "content": delta}) + "\n"
                                    if name == "suggested_actions" and (
                                        output.get("suggested_actions")
                                        or output.get("suggested_links")
                                        or output.get("ask_nyaysahayak")
                                    ):
                                        yield json.dumps({
                                            "type": "suggestions",
                                            "suggested_actions": output.get("suggested_actions") or [],
                                            "suggested_links": output.get("suggested_links") or [],
                                            "lawyer_needed": bool(output.get("lawyer_needed")),
                                            "lawyer_category": output.get("lawyer_category"),
                                            "lawyer_need_reason": output.get("lawyer_need_reason"),
                                            "agent_plan": output.get("agent_plan") or latest_case_context.get("agent_plan") or [],
                                            "phase": output.get("phase") or latest_case_context.get("phase"),
                                            "local_forum": output.get("local_forum"),
                                            "small_local_dispute": bool(output.get("small_local_dispute")),
                                            "nodal_guide_profiles": output.get("nodal_guide_profiles") or [],
                                            "ask_nyaysahayak": bool(output.get("ask_nyaysahayak")),
                                            "matched_scam_trends": output.get("matched_scam_trends") or latest_case_context.get("matched_scam_trends") or [],
                                            "scam_similarity_note": output.get("scam_similarity_note") or latest_case_context.get("scam_similarity_note") or "",
                                            "flags": {
                                                "cognizable": (output.get("structured_report") or latest_case_context.get("structured_report") or {}).get("cognizable"),
                                                "is_complex_mlat": (output.get("structured_report") or latest_case_context.get("structured_report") or {}).get("is_complex_mlat"),
                                                "fraud_under_10k": (output.get("structured_report") or latest_case_context.get("structured_report") or {}).get("fraud_under_10k"),
                                            },
                                        }) + "\n"

                                # Static handoff replies (already covered by specialist fallback above when empty)
                                
                                # Handle question_processor responses (pending questions or follow-up)
                                if name == "question_processor":
                                    if output.get("pending_questions"):
                                        yield json.dumps({
                                            "type": "pending_questions",
                                            "questions": output.get("pending_questions", []),
                                            "current_index": output.get("current_question_idx", 0),
                                            "collected_answers": output.get("collected_answers", {})
                                        }) + "\n"
                                    qp_text = strip_classification_block(
                                        str(output.get("chat_text") or output.get("final_response") or "")
                                    )
                                    if qp_text and not output.get("pdf_ready"):
                                        prefix = "\n\n" if answer_yielded else ""
                                        async for line in _emit_answer_chunks(prefix + qp_text, force=True):
                                            yield line
                                    
                                    # ✅ AUTO PDF GENERATION: When Q&A collection completes (pdf_ready=True)
                                    if output.get("pdf_ready") and not bool(output.get("sexual_offense_intake_flow", False)):
                                        print(f"📄 PDF Ready flag detected - triggering automatic PDF generation...")
                                        pdf_url = None
                                        try:
                                            # Extract required data for PDF generation
                                            raw_case_id = output.get("case_id") or latest_case_context.get("case_id")
                                            try:
                                                case_id = str(uuid.UUID(str(raw_case_id))) if raw_case_id else str(uuid.uuid4())
                                            except Exception:
                                                case_id = str(uuid.uuid4())
                                            structured_report = output.get("structured_report") or latest_case_context.get("structured_report") or {}
                                            collected_answers = output.get("collected_answers") or latest_case_context.get("collected_answers") or {}
                                            question_labels = (
                                                output.get("question_labels")
                                                or latest_case_context.get("question_labels")
                                                or (output.get("situation_summary") or {}).get("question_labels")
                                                or (latest_case_context.get("situation_summary") or {}).get("question_labels")
                                            )
                                            if isinstance(structured_report, dict) and isinstance(question_labels, dict) and question_labels:
                                                structured_report = {**structured_report, "question_labels": question_labels}
                                            
                                            # Generate and upload PDF automatically
                                            pdf_result = await run_in_threadpool(
                                                generate_and_upload_report_pdf,
                                                structured_report,
                                                case_id,
                                                user_query.user_id,
                                                collected_answers if collected_answers else None,
                                                question_labels if isinstance(question_labels, dict) else None,
                                            )
                                            
                                            if pdf_result.get("success"):
                                                source_pdf_url = pdf_result.get("url")
                                                pdf_url = source_pdf_url
                                                print(f"✅ PDF auto-generated and uploaded: {source_pdf_url}")
                                                
                                                # Optionally update case in DB with PDF URL
                                                try:
                                                    from backend.database.supabase_case_enhance import update_case_with_pdf
                                                    await run_in_threadpool(
                                                        update_case_with_pdf,
                                                        case_id,
                                                        pdf_url,
                                                        f"cases/{case_id}",
                                                        user_id=user_query.user_id,
                                                        structured_report=output.get("structured_report") or latest_case_context.get("structured_report") or {},
                                                    )
                                                    print(f"✅ Case updated with PDF URL for case_id={case_id}")
                                                except Exception as pdf_update_err:
                                                    print(f"⚠️ Warning: Could not update case with PDF URL: {pdf_update_err}")

                                                # If intervention is pending for this case, update it with PDF for moderator review.
                                                try:
                                                    await run_in_threadpool(
                                                        supabase_db.update_pending_intervention_pdf,
                                                        case_id,
                                                        pdf_url,
                                                        "moderator"
                                                    )
                                                except Exception as intervention_pdf_err:
                                                    print(f"⚠️ Warning: Could not update pending intervention with PDF: {intervention_pdf_err}")
                                            else:
                                                print(f"⚠️ PDF generation returned success=False: {pdf_result}")
                                        except Exception as pdf_gen_err:
                                            print(f"⚠️ Warning: Auto PDF generation failed (user can still download later): {pdf_gen_err}")
                                        
                                        # Send pdf_ready event to frontend with URL
                                        print(
                                            "📦 COMPLETION_EVENT "
                                            f"case_id={case_id} "
                                            f"pdf_ready={bool(pdf_url)} "
                                            f"pdf_url={pdf_url if pdf_url else 'None'} "
                                            f"answers_count={len(collected_answers or {})}"
                                        )
                                        yield json.dumps({
                                            "type": "pdf_ready",
                                            "pdf_url": pdf_url,
                                            "case_id": case_id,
                                            "message": "Case document ready for download",
                                            "case_completed": True,
                                            "structured_report": structured_report,
                                            "situation_summary": output.get("situation_summary") or latest_case_context.get("situation_summary") or {},
                                            "collected_answers": collected_answers,
                                            "user_language": output.get("user_language") or latest_case_context.get("user_language") or "english"
                                        }) + "\n"

                                        # After Q&A completion, now reveal report/risk/actions and moderation status
                                        yield json.dumps({
                                            "type": "data",
                                            "structured_report": output.get("structured_report") or latest_case_context.get("structured_report"),
                                            "suggested_actions": output.get("suggested_actions") or latest_case_context.get("suggested_actions") or [],
                                            "intervention_required": output.get("intervention_required", latest_case_context.get("intervention_required", False)),
                                            "case_id": case_id,
                                            "pending_questions": [],
                                            "current_question_idx": output.get("current_question_idx", 0),
                                            "case_completed": True
                                        }) + "\n"

                                        if output.get("intervention_required"):
                                            yield json.dumps({
                                                "type": "data",
                                                "intervention_required": True,
                                                "case_id": case_id,
                                                "intervention_collection": "moderator",
                                                "intervention_pending": True
                                            }) + "\n"

                                # ✅ AUTO PDF GENERATION: report-only flows (no follow-up questions)
                                if name == "report_generator":
                                    has_pending_questions = bool(output.get("pending_questions"))
                                    case_id = output.get("case_id") or latest_case_context.get("case_id")
                                    structured_report = output.get("structured_report") or latest_case_context.get("structured_report") or {}

                                    if (
                                        not has_pending_questions
                                        and bool(output.get("pdf_ready"))
                                        and case_id
                                        and structured_report
                                        and case_id not in generated_pdf_cases
                                    ):
                                        print(f"📄 REPORT_COMPLETE detected (no follow-up questions) - triggering automatic PDF generation...")
                                        generated_pdf_cases.add(case_id)
                                        pdf_url = None
                                        try:
                                            q_labels = (
                                                output.get("question_labels")
                                                or latest_case_context.get("question_labels")
                                                or (output.get("situation_summary") or {}).get("question_labels")
                                                or (latest_case_context.get("situation_summary") or {}).get("question_labels")
                                            )
                                            report_payload = structured_report
                                            if isinstance(report_payload, dict) and isinstance(q_labels, dict) and q_labels:
                                                report_payload = {**report_payload, "question_labels": q_labels}
                                            pdf_result = await run_in_threadpool(
                                                generate_and_upload_report_pdf,
                                                report_payload,
                                                case_id,
                                                user_query.user_id,
                                                output.get("collected_answers") or latest_case_context.get("collected_answers") or None,
                                                q_labels if isinstance(q_labels, dict) else None,
                                            )

                                            if pdf_result.get("success"):
                                                source_pdf_url = pdf_result.get("url")
                                                pdf_url = source_pdf_url
                                                print(f"✅ PDF auto-generated and uploaded: {source_pdf_url}")
                                                try:
                                                    from backend.database.supabase_case_enhance import update_case_with_pdf
                                                    await run_in_threadpool(
                                                        update_case_with_pdf,
                                                        case_id,
                                                        pdf_url,
                                                        f"cases/{case_id}",
                                                        user_id=user_query.user_id,
                                                        structured_report=output.get("structured_report") or latest_case_context.get("structured_report") or {},
                                                    )
                                                    print(f"✅ Case updated with PDF URL for case_id={case_id}")
                                                except Exception as pdf_update_err:
                                                    print(f"⚠️ Warning: Could not update case with PDF URL: {pdf_update_err}")

                                                # If intervention is pending for this case, update it with PDF for moderator review.
                                                try:
                                                    await run_in_threadpool(
                                                        supabase_db.update_pending_intervention_pdf,
                                                        case_id,
                                                        pdf_url,
                                                        "moderator"
                                                    )
                                                except Exception as intervention_pdf_err:
                                                    print(f"⚠️ Warning: Could not update pending intervention with PDF: {intervention_pdf_err}")
                                            else:
                                                print(f"⚠️ PDF generation returned success=False: {pdf_result}")
                                        except Exception as pdf_gen_err:
                                            print(f"⚠️ Warning: Auto PDF generation failed for report-only flow: {pdf_gen_err}")

                                        print(
                                            "📦 COMPLETION_EVENT "
                                            f"case_id={case_id} "
                                            f"pdf_ready={bool(pdf_url)} "
                                            f"pdf_url={pdf_url if pdf_url else 'None'} "
                                            f"answers_count={len(output.get('collected_answers') or latest_case_context.get('collected_answers') or {})}"
                                        )
                                        yield json.dumps({
                                            "type": "pdf_ready",
                                            "pdf_url": pdf_url,
                                            "case_id": case_id,
                                            "message": "Case document ready for download",
                                            "case_completed": True,
                                            "structured_report": structured_report,
                                            "situation_summary": output.get("situation_summary") or latest_case_context.get("situation_summary") or {},
                                            "collected_answers": output.get("collected_answers") or latest_case_context.get("collected_answers") or {},
                                            "user_language": output.get("user_language") or latest_case_context.get("user_language") or "english"
                                        }) + "\n"
                                
                                if (
                                    output.get("structured_report")
                                    or output.get("suggested_actions")
                                    or output.get("intervention_required")
                                    or output.get("show_female_nyayguide_panel")
                                    or output.get("show_female_lawyer_panel")
                                ):
                                    has_pending_questions = bool(output.get("pending_questions"))
                                    if has_pending_questions:
                                        yield json.dumps({
                                            "type": "data",
                                            "structured_report": None,
                                            "suggested_actions": [],
                                            "intervention_required": False,
                                            "case_id": output.get("case_id"),
                                            "pending_questions": output.get("pending_questions"),
                                            "current_question_idx": output.get("current_question_idx")
                                        }) + "\n"
                                    else:
                                        yield json.dumps({
                                            "type": "data", 
                                            "structured_report": output.get("structured_report"),
                                            "suggested_actions": output.get("suggested_actions"),
                                            "intervention_required": output.get("intervention_required", False),
                                            "case_id": output.get("case_id"),
                                            "pending_questions": output.get("pending_questions"),
                                            "current_question_idx": output.get("current_question_idx"),
                                            "case_completed": bool(name == "report_generator" and not bool(output.get("pending_questions"))),
                                            "routing_recommendation": output.get("routing_recommendation"),
                                            "show_routing_consent": bool(output.get("show_routing_consent", False)),
                                            "show_female_nyayguide_panel": bool(output.get("show_female_nyayguide_panel", False)),
                                            "female_nyayguide_profiles": output.get("female_nyayguide_profiles", []),
                                            "show_female_lawyer_panel": bool(output.get("show_female_lawyer_panel", False)),
                                            "female_lawyer_profiles": output.get("female_lawyer_profiles", []),
                                            "location": output.get("location")
                                            or (output.get("structured_report") or {}).get("location")
                                            or ((output.get("user_details") or {}).get("location") if isinstance(output.get("user_details"), dict) else None),
                                        }) + "\n"

                                        if output.get("show_routing_consent") and output.get("routing_recommendation"):
                                            yield json.dumps({
                                                "type": "routing_consent_modal",
                                                "routing": output.get("routing_recommendation")
                                            }) + "\n"
                                
                                # Emit recommended lawyers data for victim-side lawyer browser panel
                                if name == "lawyer_forwarder" and output.get("recommended_lawyers"):
                                    yield json.dumps({
                                        "type": "lawyer_recommendations",
                                        "lawyers": output.get("recommended_lawyers", []),
                                        "lawyer_case_id": output.get("lawyer_case_id"),
                                        "lawyer_category": output.get("lawyer_category"),
                                        "show_lawyer_panel": output.get("show_lawyer_panel", False)
                                    }) + "\n"

                                # Emit sahayak data for victim-side sahayak browser panel
                                if name == "sahayak" and output.get("recommended_sahayaks") is not None:
                                    yield json.dumps({
                                        "type": "sahayak_recommendations",
                                        "sahayaks": output.get("recommended_sahayaks", []),
                                        "sahayak_case_id": output.get("sahayak_case_id"),
                                        "show_sahayak_panel": output.get("show_sahayak_panel", False)
                                    }) + "\n"

                                # Emit nodal guide panel event when user consented
                                if name == "nodal_guide" and output.get("show_nodal_guide_panel"):
                                    yield json.dumps({
                                        "type": "nodal_guide_panel",
                                        "profiles": output.get("nodal_guide_profiles", []),
                                        "show_nodal_guide_panel": True,
                                        "sahayak_case_id": output.get("sahayak_case_id"),
                                    }) + "\n"

                                if output.get("forwarded_role") and output.get("forwarded_target_id"):
                                    role = str(output.get("forwarded_role"))
                                    labels = getattr(supabase_db, "FORWARD_ROLE_LABELS", {}) or {}
                                    yield json.dumps({
                                        "type": "case_forwarded",
                                        "role": role,
                                        "role_label": labels.get(role, role.replace("_", " ").title()),
                                        "target_id": output.get("forwarded_target_id"),
                                        "case_id": output.get("case_id") or latest_case_context.get("case_id"),
                                        "queue_status": "queued",
                                        "pdf_url": output.get("pdf_url") or latest_case_context.get("pdf_url"),
                                    }) + "\n"

                                if output.get("waiting_for_so_call_confirmation"):
                                    yield json.dumps({
                                        "type": "so_call_pending",
                                        "case_id": output.get("case_id") or latest_case_context.get("case_id"),
                                        "confirmation_id": output.get("so_call_confirmation_id"),
                                        "victim_phone": output.get("victim_phone"),
                                        "message": output.get("final_response") or "",
                                    }) + "\n"

                                # Emit female nyayguide panel event for direct trauma-safe flow.
                                if output.get("show_female_nyayguide_panel") and not output.get("waiting_for_so_call_confirmation"):
                                    yield json.dumps({
                                        "type": "female_nyayguide_panel",
                                        "profiles": output.get("female_nyayguide_profiles", []),
                                        "show_female_nyayguide_panel": True,
                                        "case_id": output.get("case_id")
                                    }) + "\n"

                    elif kind == "on_chat_model_stream":
                        stream_node = event.get("metadata", {}).get("langgraph_node")
                        # Stream only from user-facing specialist nodes.
                        allowed = _user_facing_stream_nodes()
                        if allowed and (not stream_node or stream_node not in allowed):
                            continue

                        content = event["data"]["chunk"].content
                        if isinstance(content, list):
                            content = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content])
                        elif not isinstance(content, str):
                            content = str(content)

                        if content and not _is_routing_only_text(content):
                            if not prefix_stripped:
                                # Accumulate until we have enough to strip prefix
                                accumulated_answer = "".join([accumulated_answer, str(content)])
                                # Flush early so the UI is not stuck on "..." waiting for a long prefix.
                                if len(accumulated_answer) >= 12 or any(c in accumulated_answer for c in ['.', '!', '?', '\n', ' ']):
                                    clean = _strip_agent_prefix(accumulated_answer)
                                    prefix_stripped = True
                                    line = _yield_answer(clean)
                                    if line:
                                        yield line
                            else:
                                line = _yield_answer(content)
                                if line:
                                    yield line
                    
                    elif kind == "on_tool_start":
                        yield json.dumps({"type": "log", "agent": "Tool", "content": f"Executing tool: {name}..."}) + "\n"
                    
                    elif kind == "on_tool_end":
                        yield json.dumps({"type": "log", "agent": "Tool", "content": f"Tool {name} finished."}) + "\n"
                
                except Exception as e:
                    try:
                        print(f"Error processing event: {e}")
                    except Exception:
                        pass
                    yield json.dumps({"type": "error", "content": f"Error processing event: {str(e)}"}) + "\n"

        except Exception as e:
            import traceback
            raw = str(e)
            try:
                traceback.print_exc()
            except Exception:
                pass
            # Stale DB checkpointer links show up as this in production after idle timeouts.
            if "connection is closed" in raw.lower() or "server closed the connection" in raw.lower():
                error_msg = (
                    "The session database link dropped mid-reply. Please send your last message again."
                )
            else:
                error_msg = f"Agent graph error: {raw}"
            yield json.dumps({"type": "error", "content": error_msg}) + "\n"
            wrap_up_yielded = True  # error already fills the assistant bubble

        if not answer_yielded and not wrap_up_yielded:
            yield json.dumps({
                "type": "wrap_up",
                "content": (
                    "I have your message. If a full reply did not appear, send it once more "
                    "and I will continue from here."
                ),
            }) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ─────────────────────────────────────────────────────────────────
# Clash Mode — adversarial legal debate simulator
# ─────────────────────────────────────────────────────────────────

@app.post("/api/clash/sessions")
async def clash_create_session(payload: ClashSessionCreate, user=Depends(get_current_user)):
    from backend.services.clash_billing import ClashQuotaExceeded, assert_can_start_clash, record_session_run

    user_id = str(user["id"])
    try:
        assert_can_start_clash(user_id)
    except ClashQuotaExceeded as exc:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "clash_quota_exceeded",
                "plan": exc.plan,
                "used": exc.used,
                "limit": exc.limit,
                "period": exc.period,
                "message": (
                    f"Clash quota reached for {exc.plan} ({exc.used}/{exc.limit} sessions "
                    f"in {exc.period}). Upgrade to continue."
                ),
            },
        ) from exc

    # Bind session to authenticated user — ignore client-supplied user_id
    payload = payload.model_copy(update={"user_id": user_id})
    session = clash_service.create_session(payload)
    record_session_run(user_id, session.session_id, mode=session.mode.value)
    return {
        "session_id": session.session_id,
        "mode": session.mode.value,
        "status": session.status,
        "user_role": session.user_role,
    }


@app.get("/api/clash/mock-cases")
async def clash_mock_cases():
    cases = clash_service.get_mock_cases()
    return {"cases": [c.model_dump() for c in cases]}


@app.put("/api/clash/sessions/{session_id}/case")
async def clash_attach_case(session_id: str, case: ClashCaseInput):
    try:
        session = clash_service.attach_case(session_id, case)
        return session.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/clash/sessions/{session_id}")
async def clash_get_session(session_id: str):
    session = clash_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.model_dump()


@app.post("/api/clash/sessions/{session_id}/stream")
async def clash_stream_debate(session_id: str):
    session = clash_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_stream():
        async for line in clash_service.stream_debate(session_id):
            yield line

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/clash/sessions/{session_id}/answer")
async def clash_submit_answer(session_id: str, body: ClashAnswerRequest):
    session = clash_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_stream():
        async for line in clash_service.stream_answer(session_id, body):
            yield line

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

@app.post("/chat/audio-stream")
async def chat_audio_stream(
    user_id: str = Form(...),
    session_id: Optional[str] = Form(None),
    file: UploadFile = File(...)
):
    """
    Streams the agent graph execution events for AUDIO input directly (no transcription).
    """
    async def event_stream():
        # Read audio file
        audio_content = await file.read()
        mime_type = "audio/webm" # Default from VoiceInput
        if file.filename.endswith(".wav"): mime_type = "audio/wav"
        elif file.filename.endswith(".mp3"): mime_type = "audio/mp3"
        elif file.filename.endswith(".m4a"): mime_type = "audio/mp4"

        print(f"🚀 STREAMING AUDIO QUERY ({mime_type}) for user {user_id}")
        
        import base64
        audio_b64 = base64.b64encode(audio_content).decode("utf-8")

        # Pass the raw audio natively to the agent graph
        message = HumanMessage(content=[
            {"type": "text", "text": "Please listen to this audio query and respond. Output an informative and helpful response."},
            {"type": "media", "mime_type": mime_type, "data": audio_b64}
        ])

        inputs = {
            "messages": [message],
            "user_details": {
                "user_id": user_id,
                "session_id": session_id
            }
        }
        
        # Accumulate streamed answer to strip prefix from start of full response
        accumulated_answer: str = ""
        prefix_stripped: bool = False
        
        try:
            # Stream events from the graph
            config = {"configurable": {"thread_id": user_id}}
            async for event in agent_graph.astream_events(inputs, config=config, version="v1"):
                kind = event["event"]
                name = event["name"]
                
                # Filter out uninteresting events
                if kind == "on_chain_start":
                    if name == "Agent": # Wrapper
                        continue
                    
                    # Notify frontend about active agent
                    if name in ["cyber", "criminal", "civil", "domestic", "scam", "document", "sahayak", "legal_moderator", "lawyer_forwarder"]:
                        yield json.dumps({"type": "agent_start", "agent": name}) + "\n"
                        # Reset prefix tracking per agent
                        accumulated_answer = ""
                        prefix_stripped = False

                    yield json.dumps({"type": "log", "agent": "System", "content": f"Starting {name}..."}) + "\n"
                
                elif kind == "on_chain_end":
                    if name in ["report_generator", "legal_moderator", "sahayak", "lawyer_forwarder"]:
                        output = event["data"].get("output", {})
                        if isinstance(output, dict) and (output.get("structured_report") or output.get("suggested_actions") or output.get("intervention_required")):
                            yield json.dumps({
                                "type": "data", 
                                "structured_report": output.get("structured_report"),
                                "suggested_actions": output.get("suggested_actions"),
                                "intervention_required": output.get("intervention_required", False),
                                "case_id": output.get("case_id")
                            }) + "\n"

                    # Fallback when token stream is empty/dropped in production.
                    if name in {"cyber", "criminal", "civil", "domestic", "scam", "document", "sexual_offense"}:
                        output = event["data"].get("output", {})
                        if isinstance(output, dict) and output.get("final_response") and not prefix_stripped and not accumulated_answer:
                            clean = _strip_agent_prefix(str(output.get("final_response") or ""))
                            if clean:
                                yield json.dumps({"type": "answer", "content": clean}) + "\n"
                                prefix_stripped = True
                                accumulated_answer = clean

                elif kind == "on_chat_model_stream":
                    stream_node = event.get("metadata", {}).get("langgraph_node")
                    allowed = _user_facing_stream_nodes()
                    if stream_node and allowed and stream_node not in allowed:
                        continue

                    content = event["data"]["chunk"].content
                    if isinstance(content, list):
                        content = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content])
                    elif not isinstance(content, str):
                        content = str(content)

                    if content:
                        if not prefix_stripped:
                            # Accumulate until we have enough to strip prefix
                            accumulated_answer = "".join([accumulated_answer, str(content)])
                            if len(accumulated_answer) >= 12 or any(c in accumulated_answer for c in ['.', '!', '?', '\n', ' ']):
                                clean = _strip_agent_prefix(accumulated_answer)
                                prefix_stripped = True
                                if clean:
                                    yield json.dumps({"type": "answer", "content": clean}) + "\n"
                        else:
                            yield json.dumps({"type": "answer", "content": content}) + "\n"
                
                elif kind == "on_tool_start":
                    yield json.dumps({"type": "log", "agent": "Tool", "content": f"Executing tool: {name}..."}) + "\n"
                
                elif kind == "on_tool_end":
                    yield json.dumps({"type": "log", "agent": "Tool", "content": f"Tool {name} finished."}) + "\n"

        except Exception as e:
            yield json.dumps({"type": "error", "content": str(e)}) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

# reload
