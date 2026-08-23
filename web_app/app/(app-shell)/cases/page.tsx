"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { useAuth } from "@/context/AuthContext";
import { useGlobalChat, type SessionRecord } from "@/context/ChatContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function asHistory(rows: unknown): SessionRecord[] {
  let value = rows;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m) =>
      m &&
      typeof m === "object" &&
      (m as SessionRecord).role !== "session_ui" &&
      Boolean(String((m as SessionRecord).content || "").trim())
  ) as SessionRecord[];
}

/** Load an existing session from ?session=; keep query until transcript is hydrated. */
function CasesSessionBootstrap() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { openCaseThread, historyCache, sessionCache, activeSessionId } = useGlobalChat();
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get("session");
    if (!sessionId) return;
    if (hydratedRef.current === sessionId) {
      router.replace("/cases", { scroll: false });
      return;
    }

    // Already opened via openCaseThread from My Cases — just strip the query.
    if (activeSessionId === sessionId && (historyCache[sessionId]?.length || sessionCache.some((s) => s.id === sessionId))) {
      hydratedRef.current = sessionId;
      router.replace("/cases", { scroll: false });
      return;
    }

    const cached = sessionCache.find((s) => s.id === sessionId);
    const cachedHist = asHistory(cached?.session_data);
    const fromHistory = asHistory(historyCache[sessionId]);
    if (cachedHist.length > 0 || fromHistory.length > 0) {
      openCaseThread(sessionId, cachedHist.length > 0 ? cachedHist : fromHistory);
      hydratedRef.current = sessionId;
      router.replace("/cases", { scroll: false });
      return;
    }

    if (!user?.uid) return;

    let cancelled = false;
    (async () => {
      try {
        const [sessionsRes, casesRes, historyRes] = await Promise.all([
          fetch(`${API_URL}/api/chat/sessions?uid=${encodeURIComponent(user.uid)}`),
          fetch(`${API_URL}/api/cases?uid=${encodeURIComponent(user.uid)}`),
          fetch(
            `${API_URL}/api/chat/history?uid=${encodeURIComponent(user.uid)}&session_id=${encodeURIComponent(sessionId)}`
          ),
        ]);

        let hist: SessionRecord[] = [];

        if (historyRes.ok) {
          const data = await historyRes.json();
          hist = asHistory(data.history);
        }

        if (!hist.length && sessionsRes.ok) {
          const data = await sessionsRes.json();
          const rows = data.sessions || [];
          const match = rows.find((s: { id: string; session_data?: unknown }) => s.id === sessionId);
          hist = asHistory(match?.session_data);
        }

        if (!hist.length && casesRes.ok) {
          const data = await casesRes.json();
          const cases = data.cases || [];
          const match = cases.find(
            (c: { session_id?: string; case_id?: string; session?: unknown }) =>
              c.session_id === sessionId || c.case_id === sessionId
          );
          hist = asHistory(match?.session);
        }

        if (!cancelled) {
          openCaseThread(sessionId, hist);
          hydratedRef.current = sessionId;
          router.replace("/cases", { scroll: false });
        }
      } catch {
        if (!cancelled) router.replace("/cases", { scroll: false });
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally narrow deps — avoid re-entry loops from cache updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user?.uid]);

  return null;
}

export default function CasesPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#F8F9FA]">
      <Suspense fallback={null}>
        <CasesSessionBootstrap />
      </Suspense>
      <ChatInterface />
    </div>
  );
}
