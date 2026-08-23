"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import type { CachedChatSession } from "@/lib/home/sessionHelpers";
import { hasSidebarCaseContent } from "@/lib/home/sessionHelpers";

export type SessionRecord = {
  role?: string;
  content?: string;
  type?: string;
  agent?: string;
  options?: string[];
};

interface ChatContextType {
  isChatOpen: boolean;
  activeQuery: string | null;
  activeSessionId: string | null;
  activeSession: SessionRecord[] | null;
  setActiveSessionId: (id: string | null) => void;
  setActiveSession: (session: SessionRecord[] | null) => void;
  openChatWithQuery: (query: string, sessionId?: string) => void;
  openChatWithSession: (sessionId: string, session: SessionRecord[]) => void;
  /** Open / resume a case thread with a known transcript (My Cases, sidebar). */
  openCaseThread: (sessionId: string, transcript: SessionRecord[]) => void;
  /** Start a fresh case thread and queue the first user message (ChatGPT-style). */
  startNewCaseChat: (query: string, sessionId?: string) => void;
  /** Empty new case — no auto-send. */
  beginNewCase: () => string;
  openChat: () => void;
  closeChat: () => void;
  clearActiveQuery: () => void;
  clearActiveSession: () => void;
  sessionCache: CachedChatSession[];
  setSessionCache: React.Dispatch<React.SetStateAction<CachedChatSession[]>>;
  upsertSessionInCache: (session: CachedChatSession) => void;
  historyCache: Record<string, SessionRecord[]>;
  updateHistoryCache: (sessionId: string, history: SessionRecord[]) => void;
  /** Remove session from caches and reset chat UI when it is the active thread. */
  deleteSession: (sessionId: string) => string | null;
  chatResetNonce: number;
}

const ChatContext = createContext<ChatContextType>({
  isChatOpen: false,
  activeQuery: null,
  activeSessionId: null,
  activeSession: null,
  setActiveSessionId: () => {},
  setActiveSession: () => {},
  openChatWithQuery: () => {},
  openChatWithSession: () => {},
  openCaseThread: () => {},
  startNewCaseChat: () => {},
  beginNewCase: () => "",
  openChat: () => {},
  closeChat: () => {},
  clearActiveQuery: () => {},
  clearActiveSession: () => {},
  sessionCache: [],
  setSessionCache: () => {},
  upsertSessionInCache: () => {},
  historyCache: {},
  updateHistoryCache: () => {},
  deleteSession: () => null,
  chatResetNonce: 0,
});

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionRecord[] | null>(null);
  const [sessionCache, setSessionCache] = useState<CachedChatSession[]>([]);
  const [historyCache, setHistoryCache] = useState<Record<string, SessionRecord[]>>({});
  const [chatResetNonce, setChatResetNonce] = useState(0);
  const deletedSessionIdsRef = useRef<Set<string>>(new Set());

  const updateHistoryCache = useCallback((sessionId: string, history: SessionRecord[]) => {
    setHistoryCache((prev) => {
      const existing = prev[sessionId];
      if (existing && JSON.stringify(existing) === JSON.stringify(history)) {
        return prev;
      }
      return { ...prev, [sessionId]: history };
    });
  }, []);

  const upsertSessionInCache = useCallback((session: CachedChatSession) => {
    if (deletedSessionIdsRef.current.has(session.id)) return;
    // Never promote empty / placeholder shells into "Your cases"
    if (!hasSidebarCaseContent(session)) {
      setSessionCache((prev) => {
        const idx = prev.findIndex((s) => s.id === session.id);
        if (idx < 0) return prev;
        return prev.filter((s) => s.id !== session.id);
      });
      return;
    }

    setSessionCache((prev) => {
      const idx = prev.findIndex((s) => s.id === session.id);
      const updatedAt = session.updated_at || new Date().toISOString();
      const row: CachedChatSession = { ...session, updated_at: updatedAt };

      if (idx >= 0) {
        const existing = prev[idx];
        const sameData =
          JSON.stringify(existing.session_data ?? []) === JSON.stringify(row.session_data ?? []);
        if (sameData) return prev;

        const next = [...prev];
        next[idx] = { ...existing, ...row, updated_at: updatedAt };
        next.sort(
          (a, b) =>
            new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
        );
        return next;
      }
      return [row, ...prev];
    });
  }, []);

  const openChatWithQuery = (query: string, sessionId?: string) => {
    const sid = sessionId || activeSessionId || crypto.randomUUID();
    setActiveSessionId(sid);
    setActiveQuery(query);
    setActiveSession(null);
    setIsChatOpen(true);
  };

  const startNewCaseChat = useCallback((query: string, sessionId?: string) => {
    const sid = sessionId || crypto.randomUUID();
    setActiveSessionId(sid);
    setActiveQuery(query.trim());
    setActiveSession(null);
    setIsChatOpen(true);
  }, []);

  const beginNewCase = useCallback(() => {
    const sid = crypto.randomUUID();
    setActiveSessionId(sid);
    setActiveQuery(null);
    setActiveSession(null);
    setIsChatOpen(true);
    return sid;
  }, []);

  const openChatWithSession = (sessionId: string, session: SessionRecord[]) => {
    setActiveSessionId(sessionId);
    setActiveSession(session);
    setActiveQuery(null);
    setIsChatOpen(true);
  };

  const openCaseThread = useCallback((sessionId: string, transcript: SessionRecord[]) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return;
    const hist = Array.isArray(transcript) ? transcript : [];
    setHistoryCache((prev) => ({ ...prev, [sid]: hist }));
    setSessionCache((prev) => {
      const idx = prev.findIndex((s) => s.id === sid);
      const row: CachedChatSession = {
        id: sid,
        session_data: hist,
        updated_at: new Date().toISOString(),
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...row };
        return next;
      }
      return hist.length > 0 ? [row, ...prev] : prev;
    });
    setActiveSessionId(sid);
    setActiveSession(hist);
    setActiveQuery(null);
    setIsChatOpen(true);
  }, []);

  const openChat = () => setIsChatOpen(true);

  const closeChat = () => {
    setIsChatOpen(false);
  };

  const clearActiveQuery = () => {
    setActiveQuery(null);
  };

  const clearActiveSession = () => {
    setActiveSession(null);
  };

  const deleteSession = useCallback(
    (sessionId: string) => {
      deletedSessionIdsRef.current.add(sessionId);

      setSessionCache((prev) => prev.filter((s) => s.id !== sessionId));
      setHistoryCache((prev) => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      let nextActiveId: string | null = null;
      if (activeSessionId === sessionId) {
        nextActiveId = crypto.randomUUID();
        setActiveSessionId(nextActiveId);
        setActiveSession(null);
        setActiveQuery(null);
        setChatResetNonce((n) => n + 1);
      }
      return nextActiveId;
    },
    [activeSessionId]
  );

  return (
    <ChatContext.Provider
      value={{
        isChatOpen,
        activeQuery,
        activeSession,
        activeSessionId,
        setActiveSession,
        setActiveSessionId,
        openChatWithQuery,
        openChatWithSession,
        openCaseThread,
        startNewCaseChat,
        beginNewCase,
        openChat,
        closeChat,
        clearActiveQuery,
        clearActiveSession,
        sessionCache,
        setSessionCache,
        upsertSessionInCache,
        historyCache,
        updateHistoryCache,
        deleteSession,
        chatResetNonce,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useGlobalChat = () => useContext(ChatContext);
