/**
 * LiveKit Voice Session Client API
 * Handles token fetching and voice session communications scoped to case_id.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export interface VoiceSessionResponse {
  status: string;
  case_id: string;
  room_name: string;
  server_url: string;
  token: string;
  participant_identity: string;
  agent_status: string;
  context_building?: any;
  confidence_score?: number;
  voice_session_id?: string;
  livekit_configured?: boolean;
  stt_provider?: string;
  tts_provider?: string;
  sarvam_configured?: boolean;
  voice_profile?: any;
}

export interface VoiceTurnResponse {
  status: string;
  case_id: string;
  spoken_response: string;
  text?: string;
  action?: "none" | "ask_clarification" | "request_nyayguide" | "human_review";
  requires_confirmation?: boolean;
  assistance_type?: "document_support" | "office_navigation" | "complaint_filing_support" | "digital_assistance" | "other" | null;
  safe_task_summary?: string | null;
  escalation_reason?: string | null;
  resolution_status: string;
  active_agent: string;
  confidence_score: number;
  user_transcript?: string;
  handoff_packet?: any;
  state?: any;
  voice_profile?: any;
}

/**
 * Requests a LiveKit voice session token from the backend scoped to `case_id`.
 */
export async function requestVoiceSessionToken(params: {
  caseId: string;
  userId?: string | null;
  sessionId?: string | null;
  userName?: string;
  contextBuilding?: any;
  transcript?: any[];
}): Promise<VoiceSessionResponse> {
  const payload = {
    case_id: params.caseId,
    user_id: params.userId || undefined,
    session_id: params.sessionId || undefined,
    user_name: params.userName || "Citizen",
    context_building: params.contextBuilding || {},
    transcript: params.transcript || [],
  };

  const res = await fetch(`${API_URL}/api/voice-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to initialize voice session (${res.status}): ${errText}`);
  }

  return res.json();
}

/**
 * Sends a text turn to the voice agent reasoning worker.
 */
export async function sendVoiceTurn(
  caseId: string,
  userText: string
): Promise<VoiceTurnResponse> {
  const res = await fetch(`${API_URL}/api/voice-session/${encodeURIComponent(caseId)}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_text: userText }),
  });

  if (!res.ok) {
    throw new Error(`Voice turn error: ${res.status}`);
  }

  return res.json();
}

/**
 * Sends recorded audio bytes directly to the Sarvam AI STT agent worker.
 */
export async function sendVoiceAudioTurn(
  caseId: string,
  audioBlob: Blob,
  language: string = "en-IN"
): Promise<VoiceTurnResponse> {
  const formData = new FormData();
  formData.append("file", audioBlob, "user_voice.webm");
  formData.append("language", language);

  const res = await fetch(`${API_URL}/api/voice-session/${encodeURIComponent(caseId)}/audio-turn`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Voice audio turn error: ${res.status}`);
  }

  return res.json();
}

/**
 * Finalizes the voice session and saves verified details to the case.
 */
export async function completeVoiceSession(caseId: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/voice-session/${encodeURIComponent(caseId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to complete voice session: ${res.status}`);
  }

  return res.json();
}
