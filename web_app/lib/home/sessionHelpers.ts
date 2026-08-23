import type { SidebarCaseSession } from "@/lib/home/mockData";

export type CachedChatSession = {
  id: string;
  session_data?: Array<{ role?: string; content?: string; type?: string }>;
  /** Restored suggestions / PDF chrome for this thread */
  case_ui?: Record<string, unknown> | null;
  updated_at?: string;
};

function isChatMessage(m: { role?: string; content?: string; type?: string }) {
  if (!m || m.role === "session_ui") return false;
  return Boolean((m.content || "").trim());
}

/** Real case history only — skip empty shells / session_ui-only / blank placeholders. */
export function hasSidebarCaseContent(session: CachedChatSession | null | undefined): boolean {
  const data = session?.session_data || [];
  return data.some(
    (m) =>
      (m.role === "user" || m.type === "user" || m.role === "assistant") &&
      Boolean((m.content || "").trim())
  );
}

export function sessionTitle(session: CachedChatSession): string {
  const data = (session.session_data || []).filter(isChatMessage);
  const firstUser = data.find((m) => m.role === "user" || m.type === "user");
  const text = (firstUser?.content || "").trim();
  if (!text) return "Untitled case";
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

export function sessionPreview(session: CachedChatSession): string {
  const data = (session.session_data || []).filter(isChatMessage);
  const last = [...data].reverse().find((m) => (m.content || "").trim());
  const text = (last?.content || "No messages yet").trim();
  return text.length > 56 ? `${text.slice(0, 56)}…` : text;
}

export function toSidebarSession(session: CachedChatSession): SidebarCaseSession {
  return {
    id: session.id,
    title: sessionTitle(session),
    preview: sessionPreview(session),
    updated_at: session.updated_at || new Date().toISOString(),
  };
}
