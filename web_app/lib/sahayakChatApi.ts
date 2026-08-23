import type { SahayakMessage, SahayakProfile, SahayakThread } from "./sahayakTypes";
import { normalizeSahayakProfile } from "./sahayakTypes";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function authHeaders(token?: string | null): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function connectSahayakThread(
  token: string,
  opts: {
    sahayakUserId: string;
    sahayakCaseId?: string | null;
    victimUserId?: string | null;
    initialMessage?: string;
  }
): Promise<{ thread: SahayakThread; sahayak?: SahayakProfile }> {
  const res = await fetch(`${API_URL}/api/sahayak-chat/threads`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      sahayak_user_id: opts.sahayakUserId,
      sahayak_case_id: opts.sahayakCaseId || undefined,
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
    sahayak: data.sahayak ? normalizeSahayakProfile(data.sahayak) : undefined,
  };
}

export async function listSahayakThreads(
  token: string,
  perspective?: "victim" | "sahayak"
): Promise<SahayakThread[]> {
  const qs = perspective ? `?perspective=${encodeURIComponent(perspective)}` : "";
  const res = await fetch(`${API_URL}/api/sahayak-chat/threads${qs}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load threads (${res.status})`);
  const data = await res.json();
  return data.threads || [];
}

export async function fetchSahayakMessages(
  token: string,
  threadId: string,
  after?: string | null
): Promise<SahayakMessage[]> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : "";
  const res = await fetch(`${API_URL}/api/sahayak-chat/threads/${threadId}/messages${qs}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
  const data = await res.json();
  return data.messages || [];
}

export async function sendSahayakMessage(
  token: string,
  threadId: string,
  body: string
): Promise<SahayakMessage> {
  const res = await fetch(`${API_URL}/api/sahayak-chat/threads/${threadId}/messages`, {
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

export type UnreadChatItem = {
  channel: string;
  thread_id: string;
  case_id?: string | null;
  peer_name: string;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count: number;
  href: string;
};

export type UnreadChatPayload = {
  total_unread: number;
  items: UnreadChatItem[];
};

export async function fetchUnreadChat(token: string): Promise<UnreadChatPayload> {
  const res = await fetch(`${API_URL}/api/chat/unread`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load unread (${res.status})`);
  return res.json();
}

export async function markChatThreadRead(
  token: string,
  channel: "lawyer" | "sahayak",
  threadId: string
): Promise<void> {
  await fetch(`${API_URL}/api/chat/threads/${channel}/${threadId}/read`, {
    method: "POST",
    headers: authHeaders(token),
  });
}
