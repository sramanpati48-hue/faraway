import type { LawyerMessage, LawyerProfile, LawyerThread } from "./lawyerTypes";
import { normalizeLawyerProfile } from "./lawyerTypes";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function authHeaders(token?: string | null): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function connectLawyerThread(
  token: string,
  opts: {
    lawyerUserId: string;
    lawyerCaseId?: string | null;
    victimUserId?: string | null;
    initialMessage?: string;
  }
): Promise<{ thread: LawyerThread; lawyer?: LawyerProfile }> {
  const res = await fetch(`${API_URL}/api/lawyer-chat/threads`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      lawyer_user_id: opts.lawyerUserId,
      lawyer_case_id: opts.lawyerCaseId || undefined,
      victim_user_id: opts.victimUserId || undefined,
      initial_message: opts.initialMessage || undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Connect failed (${res.status})`);
  }
  const data = await res.json();
  return {
    thread: data.thread,
    lawyer: data.lawyer ? normalizeLawyerProfile(data.lawyer) : undefined,
  };
}

export async function listLawyerThreads(
  token: string,
  perspective?: "victim" | "lawyer"
): Promise<LawyerThread[]> {
  const qs = perspective ? `?perspective=${encodeURIComponent(perspective)}` : "";
  const res = await fetch(`${API_URL}/api/lawyer-chat/threads${qs}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load threads (${res.status})`);
  const data = await res.json();
  return data.threads || [];
}

export async function fetchLawyerMessages(
  token: string,
  threadId: string,
  after?: string | null
): Promise<LawyerMessage[]> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : "";
  const res = await fetch(`${API_URL}/api/lawyer-chat/threads/${threadId}/messages${qs}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
  const data = await res.json();
  return data.messages || [];
}

export async function sendLawyerMessage(
  token: string,
  threadId: string,
  body: string
): Promise<LawyerMessage> {
  const res = await fetch(`${API_URL}/api/lawyer-chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Send failed (${res.status})`);
  }
  const data = await res.json();
  return data.message;
}

export async function fetchLawyerProfile(uid: string): Promise<LawyerProfile | null> {
  const res = await fetch(`${API_URL}/api/lawyer/profile/${uid}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.profile ? normalizeLawyerProfile(data.profile) : null;
}
