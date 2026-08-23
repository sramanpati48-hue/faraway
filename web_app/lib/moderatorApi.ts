const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("nyaya_access_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type ModeratorStats = {
  cases_per_hour: number;
  assigned_in_hour: number;
  capacity_remaining: number;
  open_pending: number;
  sla_minutes: number;
  delay_tick_minutes: number;
  respect_score: number;
  delay_score_total: number;
  cases_resolved: number;
  cases_breached: number;
  overdue_open: number;
};

export async function fetchModeratorStats(): Promise<ModeratorStats> {
  const res = await fetch(`${API_URL}/api/moderator/stats`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Failed to load stats");
  return data as ModeratorStats;
}

export async function fetchMyInterventions(): Promise<{ cases: any[]; stats: ModeratorStats }> {
  const res = await fetch(`${API_URL}/api/interventions/moderator/mine`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Failed to load queue");
  return { cases: data.cases || [], stats: data.stats };
}

export async function fetchModeratorHistory(limit = 50): Promise<any[]> {
  const res = await fetch(
    `${API_URL}/api/interventions/moderator/history?limit=${limit}`,
    { headers: authHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Failed to load history");
  return data.cases || [];
}

export type SoCallConfirmation = {
  id: string;
  case_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  victim_name?: string | null;
  victim_phone?: string | null;
  structured_report?: Record<string, unknown>;
  document_summary?: string | null;
  status: string;
  assigned_nyayguide_id?: string | null;
  assigned_nyayguide_name?: string | null;
  sahayak_case_id?: string | null;
  created_at?: string;
  call_confirmed_at?: string | null;
};

export type FemaleNyayGuideOption = {
  id?: string;
  uid?: string;
  name?: string;
  contact_number?: string;
  city?: string;
  state?: string;
};

export async function fetchSoCallConfirmations(status = "pending_call"): Promise<{
  cases: SoCallConfirmation[];
  guides: FemaleNyayGuideOption[];
}> {
  const res = await fetch(
    `${API_URL}/api/moderator/sexual-offense-confirmations?status=${encodeURIComponent(status)}`,
    { headers: authHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Failed to load confirmation queue");
  return { cases: data.cases || [], guides: data.guides || [] };
}

export async function markSoConfirmationCall(
  confirmationId: string,
  body: { call_done: boolean; nyayguide_id?: string; nyayguide_name?: string }
): Promise<SoCallConfirmation> {
  const res = await fetch(
    `${API_URL}/api/moderator/sexual-offense-confirmations/${confirmationId}/call`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Failed to update call");
  return data.confirmation as SoCallConfirmation;
}

export async function resolveIntervention(body: {
  case_id: string;
  moderator_response: string;
  moderator_options: unknown[];
  routing_recommendation?: unknown;
  moderator_id?: string;
  moderator_summary?: string;
  moderator_notes?: string;
  moderator_report?: Record<string, unknown>;
  moderator_suggested_links?: unknown[];
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/interventions/resolve`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to resolve");
  }
}

export type VoiceSessionAuditItem = {
  id: string;
  case_id: string;
  user_id?: string | null;
  session_id?: string | null;
  started_at: string;
  ended_at?: string | null;
  resolution_status: string;
  confidence_score?: number | null;
  confidence_score_history?: { score: number; turn: number; timestamp: number }[];
  escalated: boolean;
  escalation_reason?: string | null;
  risk_flags?: string[];
  threat_level?: string | null;
  full_transcript?: { role: string; text: string; agent?: string; timestamp?: number }[];
  transcript_turns?: number;
  agent_decision_log?: { agent: string; decision: string; reason: string; turn?: number; timestamp?: number }[];
  decision_count?: number;
  incident_type?: string;
  case_summary?: string;
  created_at: string;
  updated_at: string;
};

export async function fetchVoiceSessionAudits(limit = 50, offset = 0): Promise<VoiceSessionAuditItem[]> {
  const res = await fetch(
    `${API_URL}/api/moderator/voice-audit?limit=${limit}&offset=${offset}`,
    { headers: authHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Failed to load voice audit records");
  return (data.sessions || []) as VoiceSessionAuditItem[];
}

export async function fetchVoiceSessionAuditDetail(sessionId: string): Promise<VoiceSessionAuditItem> {
  const res = await fetch(
    `${API_URL}/api/moderator/voice-audit/${encodeURIComponent(sessionId)}`,
    { headers: authHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Failed to load voice session audit details");
  return data.session as VoiceSessionAuditItem;
}
