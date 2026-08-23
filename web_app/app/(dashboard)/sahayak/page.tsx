"use client";

import React, { Suspense, useState, useEffect, useRef } from "react";
import {
  HeartHandshake, Loader2, MapPin, User, CheckCircle2,
  RefreshCw, Clock, Calendar, ChevronDown, Scale,
  MessageCircle, FileDown, Phone, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { SahayakChatPane } from "@/components/sahayak/SahayakChatPane";
import { SahayakCaseModal } from "@/components/sahayak/SahayakCaseModal";
import { connectSahayakThread, listSahayakThreads } from "@/lib/sahayakChatApi";
import type { SahayakThread } from "@/lib/sahayakTypes";

interface SahayakCase {
  id: string;
  user_id: string;
  user_name: string;
  structured_report: {
    incident_type?: string;
    risk_level?: string;
    summary?: string;
    statutory_sections?: string[];
    checklist?: string[];
    location?: string | { city?: string; state?: string };
    contact?: string;
    pdf_url?: string | null;
    case_category?: string;
  };
  location?: { city?: string; state?: string; lat?: number; lon?: number };
  status: "pending" | "accepted";
  assigned_sahayak_id?: string;
  assigned_sahayak_name?: string;
  guide_kind?: string;
  created_at: string;
  updated_at: string;
  pdf_url?: string | null;
}

const RISK_COLORS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700 border-red-200",
  MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
  LOW: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Safely converts any structured_report field to a displayable string.
 * Handles: plain string, object {city, state, lat, lon}, arrays, numbers.
 */
function formatField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(v => formatField(v)).join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Location object pattern: {city, state, lat, lon}
    const parts: string[] = [];
    if (obj.city)  parts.push(String(obj.city));
    if (obj.state) parts.push(String(obj.state));
    if (parts.length) return parts.join(", ");
    // Generic object fallback: join key=value pairs
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }
  return String(value);
}


export default function SahayakDashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <Loader2 className="w-8 h-8 text-[#00634B] animate-spin" />
        </div>
      }
    >
      <SahayakDashboardInner />
    </Suspense>
  );
}

function SahayakDashboardInner() {
  const { user, role, loading: authLoading, accessToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cases, setCases] = useState<SahayakCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<SahayakCase | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"pending" | "accepted" | "chats">("pending");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [deepLinkPeer, setDeepLinkPeer] = useState<string | null>(null);
  const [threads, setThreads] = useState<SahayakThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [queueSummaryOpen, setQueueSummaryOpen] = useState(false);
  const skipChatResetRef = useRef(false);
  const deepLinkCaseTriedRef = useRef<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Auth protection
  useEffect(() => {
    if (authLoading || !mounted) return;
    if (!user) { router.push("/login"); }
  }, [user, authLoading, mounted, router]);

  // Fetch profile + cases
  useEffect(() => {
    if (!user) return;
    fetchProfile();
    fetchCases();
  }, [user]);

  const fetchThreads = async () => {
    if (!accessToken) return;
    setThreadsLoading(true);
    try {
      const rows = await listSahayakThreads(accessToken, "sahayak");
      setThreads(rows || []);
    } catch (e) {
      console.error("Error fetching sahayak threads:", e);
    } finally {
      setThreadsLoading(false);
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    void fetchThreads();
  }, [accessToken]);

  // URL ?tab=chats|pending|accepted
  useEffect(() => {
    const tab = (searchParams.get("tab") || "").toLowerCase();
    if (tab === "chats" || tab === "accepted" || tab === "pending") {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Reset chat when selected case changes on Help Queue (skip once for deep-link)
  useEffect(() => {
    if (activeTab === "chats") return;
    if (skipChatResetRef.current) {
      skipChatResetRef.current = false;
      return;
    }
    setThreadId(null);
    setChatOpen(false);
    setSelectedThreadId(null);
  }, [selectedCase?.id, activeTab]);

  const openThread = (row: SahayakThread) => {
    skipChatResetRef.current = true;
    setSelectedThreadId(String(row.id));
    setThreadId(String(row.id));
    setChatOpen(true);
    setDeepLinkPeer(row.victim_name || "Client");
    setActiveTab("chats");
    if (row.sahayak_case_id) {
      const match = cases.find((c) => c.id === row.sahayak_case_id);
      if (match) setSelectedCase(match);
      else setSelectedCase(null);
    } else {
      setSelectedCase(null);
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "chats");
    params.set("thread", String(row.id));
    if (row.sahayak_case_id) params.set("case", row.sahayak_case_id);
    else params.delete("case");
    router.replace(`/sahayak?${params.toString()}`, { scroll: false });
  };

  const selectMainTab = (tab: "pending" | "accepted" | "chats") => {
    setActiveTab(tab);
    setCaseModalOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    if (tab !== "chats") {
      params.delete("thread");
      setChatOpen(false);
      setThreadId(null);
      setSelectedThreadId(null);
      setSummaryOpen(false);
      setSelectedCase(null);
    } else {
      setSelectedCase(null);
      setChatOpen(false);
      setThreadId(null);
      setSelectedThreadId(null);
      setSummaryOpen(false);
      void fetchThreads();
    }
    router.replace(`/sahayak?${params.toString()}`, { scroll: false });
  };

  // Deep-link: ?thread=&case= (chat opens even when the thread has no linked case)
  useEffect(() => {
    const caseId = searchParams.get("case");
    const thread = searchParams.get("thread");
    const tab = (searchParams.get("tab") || "").toLowerCase();
    if (!caseId && !thread) return;

    if (caseId && cases.length) {
      const match = cases.find((c) => c.id === caseId);
      if (match) {
        skipChatResetRef.current = true;
        setSelectedCase(match);
        if (thread || tab === "chats") {
          setActiveTab("chats");
          setCaseModalOpen(false);
        } else if (!thread) {
          setActiveTab(match.status === "accepted" ? "accepted" : "pending");
          setCaseModalOpen(true);
        }
      }
    }

    if (thread) {
      setActiveTab("chats");
      setSelectedThreadId(thread);
      setThreadId(thread);
      setChatOpen(true);
    }
  }, [cases, searchParams]);

  useEffect(() => {
    const thread = searchParams.get("thread");
    if (!thread || !accessToken) return;

    let cancelled = false;
    void (async () => {
      try {
        const rows = await listSahayakThreads(accessToken, "sahayak");
        if (cancelled) return;
        setThreads(rows || []);
        const row = rows.find((t) => String(t.id) === thread);
        if (!row) return;
        setDeepLinkPeer(row.victim_name || "Client");
        setSelectedThreadId(String(row.id));
        setActiveTab("chats");
        if (!row.sahayak_case_id || !cases.length) return;
        const match = cases.find((c) => c.id === row.sahayak_case_id);
        if (match) {
          skipChatResetRef.current = true;
          setSelectedCase(match);
        }
      } catch (e) {
        console.warn("Deep-link thread resolve failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, accessToken, cases]);

  // WebSocket Listener for real-time new sahayak cases
  useEffect(() => {
    if (!user) return;

    const wsBaseUrl = (API_URL || "http://localhost:8000").replace(/^http/, "ws");
    let wsDestroyed = false;
    let wsReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket;

    const connectSahayakWS = () => {
      if (wsDestroyed) return;
      ws = new WebSocket(`${wsBaseUrl}/ws/sahayak`);
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({
            type: "identify",
            uid: user.uid,
            role: role || "sahayak",
            state: profile?.state || "",
            city: profile?.city || "",
            open_cases: 0,
          }));
        } catch { /* ignore */ }
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "new_sahayak_case") {
            const newCase: SahayakCase = {
              id: data.case_id,
              user_id: data.user_id,
              user_name: data.user_name || "User",
              structured_report: data.structured_report || {},
              location: data.location || data.structured_report?.location || {},
              status: "pending",
              created_at: data.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            setCases(prev => {
              if (prev.find(c => c.id === newCase.id)) return prev;
              return [newCase, ...prev];
            });
          } else if (data.type === "case_claimed" && data.case_id) {
            setCases(prev => prev.filter(c => c.id !== data.case_id || c.status === "accepted"));
            if (selectedCase && selectedCase.id === data.case_id && selectedCase.status === "pending") {
              setSelectedCase(null);
            }
          }
        } catch (e) {
          console.error("WebSocket message parsing error", e);
        }
      };
      ws.onclose = () => {
        if (!wsDestroyed) {
          wsReconnectTimeout = setTimeout(connectSahayakWS, 3000);
        }
      };
      ws.onerror = () => {
        console.error("Sahayak WebSocket error");
      };
    };

    connectSahayakWS();

    return () => {
      wsDestroyed = true;
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [user, role, profile?.state, profile?.city]);

  const fetchProfile = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_URL}/api/sahayak/profile/${user.uid}`);
      const data = await res.json();
      if (data.profile) setProfile(data.profile);
    } catch { /* silent */ }
  };

  const fetchCases = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/sahayak/cases/${user.uid}`);
      const data = await res.json();
      const allCases: SahayakCase[] = (data.cases || []).map((c: SahayakCase) => ({
        ...c,
        pdf_url: c.pdf_url || c.structured_report?.pdf_url || null,
      }));
      setCases(allCases);
      setSelectedCase(prev => (prev ? allCases.find(c => c.id === prev.id) || null : null));
    } catch (e) {
      console.error("Error fetching sahayak cases:", e);
    } finally {
      setLoading(false);
    }
  };

  const openCasePdf = (caseItem: SahayakCase) => {
    const direct = caseItem.pdf_url || caseItem.structured_report?.pdf_url;
    const url = direct || `${API_URL}/api/cases/${encodeURIComponent(caseItem.id)}/pdf`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const closeCaseModal = () => {
    setCaseModalOpen(false);
    if (activeTab !== "chats") setSelectedCase(null);
  };

  const openCaseModal = (c: SahayakCase) => {
    setSelectedCase(c);
    setCaseModalOpen(true);
  };

  const handleAcceptCase = async (c: SahayakCase) => {
    if (!user) return;
    setAccepting(true);
    try {
      const res = await fetch(`${API_URL}/api/sahayak/cases/${c.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sahayak_id: user.uid, sahayak_name: profile?.name || user.display_name || "Nyay Guide" }),
      });
      if (res.ok) {
        const updated: SahayakCase = { ...c, status: "accepted", assigned_sahayak_id: user.uid };
        setCases(prev => prev.map(x => x.id === c.id ? updated : x));
        setSelectedCase(updated);
        setActiveTab("accepted");
        if (accessToken) {
          try {
            await connectSahayakThread(accessToken, {
              sahayakUserId: user.uid,
              sahayakCaseId: c.id,
              victimUserId: c.user_id,
              initialMessage:
                "Hello — I’ve accepted your case and I’m here to help as your Nyay Guide. Please share any urgent details.",
            });
            void fetchThreads();
          } catch (e) {
            console.warn("Thread create after accept failed", e);
          }
        }
      }
    } catch (e) { console.error(e); }
    finally { setAccepting(false); }
  };

  const handleDeclineCase = async (c: SahayakCase) => {
    if (!user) return;
    setDeclining(true);
    try {
      const res = await fetch(`${API_URL}/api/sahayak/cases/${c.id}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sahayak_id: user.uid }),
      });
      if (res.ok) {
        setCases((prev) => prev.filter((x) => x.id !== c.id));
        closeCaseModal();
      } else {
        // Fallback: hide locally if API/migration not ready yet
        setCases((prev) => prev.filter((x) => x.id !== c.id));
        closeCaseModal();
      }
    } catch (e) {
      console.error(e);
      setCases((prev) => prev.filter((x) => x.id !== c.id));
      closeCaseModal();
    } finally {
      setDeclining(false);
    }
  };

  const openClientChat = async (caseItem?: SahayakCase | null) => {
    const target = caseItem || selectedCase;
    if (!target || !user || !accessToken) return;
    setChatLoading(true);
    try {
      const { thread } = await connectSahayakThread(accessToken, {
        sahayakUserId: user.uid,
        sahayakCaseId: target.id,
        victimUserId: target.user_id,
      });
      openThread({
        ...thread,
        victim_name: target.user_name || thread.victim_name || "Client",
        sahayak_case_id: target.id,
      });
      void fetchThreads();
    } catch (e: any) {
      alert(e.message || "Could not open chat");
    } finally {
      setChatLoading(false);
    }
  };

  /** Chats tab: pick an accepted case first, then open (or create) its thread. */
  const selectChatCase = async (c: SahayakCase) => {
    skipChatResetRef.current = true;
    setSelectedCase(c);
    setDeepLinkPeer(c.user_name || "Client");
    setActiveTab("chats");
    setSummaryOpen(false);
    const existing =
      threads.find((t) => t.sahayak_case_id === c.id) ||
      threads.find((t) => t.victim_user_id === c.user_id);
    if (existing) {
      openThread({
        ...existing,
        victim_name: c.user_name || existing.victim_name || "Client",
        sahayak_case_id: c.id,
      });
      return;
    }
    await openClientChat(c);
  };

  // Deep-link / refresh: ?tab=chats&case= without thread → open that case's chat
  useEffect(() => {
    if (activeTab !== "chats" || !accessToken || chatLoading || chatOpen) return;
    const caseId = searchParams.get("case");
    const thread = searchParams.get("thread");
    if (!caseId || thread || !cases.length) return;
    if (deepLinkCaseTriedRef.current === caseId) return;
    const match = cases.find((c) => c.id === caseId && c.status === "accepted");
    if (!match) return;
    deepLinkCaseTriedRef.current = caseId;
    void selectChatCase(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed to URL + cases
  }, [activeTab, accessToken, cases, searchParams, chatOpen, chatLoading]);

  const pending = cases.filter(c => c.status === "pending");
  const accepted = cases.filter(c => c.status === "accepted" && c.assigned_sahayak_id === user?.uid);
  const displayed = activeTab === "pending" ? pending : activeTab === "accepted" ? accepted : [];
  const threadForCase = (c: SahayakCase) =>
    threads.find((t) => t.sahayak_case_id === c.id) ||
    threads.find((t) => t.victim_user_id === c.user_id);

  const riskLevel = (c: SahayakCase) =>
    (c.structured_report?.risk_level || "MEDIUM").toUpperCase();

  if (!mounted || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-6.5rem)] md:h-[calc(100dvh-5.5rem)] -m-4 sm:-m-6 md:-m-8 bg-gray-50 font-sans overflow-hidden rounded-none">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
        {/* Compact top row: title + stats + refresh */}
        <div className="bg-white border-b border-gray-100 px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 shrink-0 min-h-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-7 h-7 bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0">
              <HeartHandshake className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-black text-gray-900 text-sm leading-tight truncate">
                {activeTab === "chats" ? "Client Chats" : "Help Queue"}
              </h1>
              {profile?.name && (
                <p className="text-[10px] text-gray-500 truncate leading-tight">
                  {profile.name}
                </p>
              )}
            </div>
          </div>

          {activeTab !== "chats" && (
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border bg-amber-50 border-amber-100 text-amber-700">
                <Clock className="w-3 h-3 shrink-0" />
                <span className="text-xs font-black tabular-nums">{pending.length}</span>
                <span className="text-[10px] font-semibold opacity-70 hidden sm:inline">Pending</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border bg-emerald-50 border-emerald-100 text-emerald-700">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span className="text-xs font-black tabular-nums">{accepted.length}</span>
                <span className="text-[10px] font-semibold opacity-70 hidden sm:inline">Accepted</span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              void fetchCases();
              void fetchThreads();
            }}
            disabled={loading || threadsLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-900 text-white font-bold text-[11px] rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={12} className={loading || threadsLoading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden px-3 sm:px-4 pb-3 pt-2 gap-3 min-h-0">
          {/* Left: Case List — full height beside detail pane */}
          <div className={cn(
            "w-full md:w-72 xl:w-80 flex flex-col gap-2 overflow-y-auto shrink-0 min-h-0 md:h-full",
            selectedCase || (activeTab === "chats" && chatOpen) ? "hidden md:flex" : "flex flex-1"
          )}>
            {/* Help Queue only: Pending / Accepted */}
            {activeTab !== "chats" ? (
              <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
                {(
                  [
                    { id: "pending" as const, label: `Pending (${pending.length})` },
                    { id: "accepted" as const, label: `Accepted (${accepted.length})` },
                  ]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectMainTab(tab.id)}
                    className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all ${
                      activeTab === tab.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-1 py-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Select a case to chat
                </p>
              </div>
            )}

            {activeTab === "chats" ? (
              loading || threadsLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-[#00634B] animate-spin" />
                </div>
              ) : accepted.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <MessageCircle className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm font-semibold">No accepted cases yet</p>
                  <p className="text-xs mt-2 px-4">
                    Accept a case from Help Queue, then return here to message the client.
                  </p>
                </div>
              ) : (
                accepted.map((c) => {
                  const th = threadForCase(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void selectChatCase(c)}
                      disabled={chatLoading}
                      className={`w-full text-left p-4 rounded-2xl border transition-all disabled:opacity-60 ${
                        selectedCase?.id === c.id && chatOpen
                          ? "border-[#00634B] bg-[#E6F0ED] shadow-sm"
                          : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-bold text-gray-900 text-sm truncate">
                          {c.user_name || "Client"}
                        </p>
                        <MessageCircle size={14} className="text-[#00634B] shrink-0" />
                      </div>
                      <p className="text-xs text-gray-600 font-semibold truncate">
                        {c.structured_report?.incident_type || "Legal Case"}
                      </p>
                      <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                        {th?.last_message || "Tap to open chat"}
                      </p>
                    </button>
                  );
                })
              )
            ) : loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            ) : displayed.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <HeartHandshake className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                <p className="text-sm font-semibold">No {activeTab} cases</p>
              </div>
            ) : (
              displayed.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCase(c);
                    setQueueSummaryOpen(false);
                    setChatOpen(false);
                  }}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    selectedCase?.id === c.id
                      ? "border-blue-600 bg-blue-50 shadow-sm"
                      : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${RISK_COLORS[riskLevel(c)] || RISK_COLORS["MEDIUM"]}`}>
                      {riskLevel(c)} RISK
                    </span>
                    {(c.guide_kind === "female_nyayguide" || c.structured_report?.case_category === "sexual_offence") && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700">
                        Confidential
                      </span>
                    )}
                    {c.status === "accepted" && (
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    )}
                  </div>
                  <p className="font-bold text-gray-900 text-sm truncate">
                    {c.structured_report?.incident_type || "Legal Case"}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                    <User size={10} /> {c.user_name || "Anonymous"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                    <Calendar size={10} />
                    {new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </button>
              ))
            )}
          </div>

          {/* Right: Help Queue detail OR Client Chats (case-first) */}
          <div className={cn(
            "flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden",
            !selectedCase && !(activeTab === "chats" && chatOpen && threadId) ? "hidden md:flex" : "flex"
          )}>
            {activeTab === "chats" ? (
              !selectedCase && chatOpen && threadId && accessToken && user ? (
                <div className="flex-1 flex flex-col min-h-[50vh] bg-white rounded-3xl border border-gray-100 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-[#F8F9FA]">
                    <div>
                      <p className="text-sm font-black text-gray-900">Client chat</p>
                      <p className="text-xs text-gray-500">{deepLinkPeer || "Client"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setChatOpen(false);
                        setSelectedThreadId(null);
                        setThreadId(null);
                        const params = new URLSearchParams(searchParams.toString());
                        params.delete("thread");
                        router.replace(`/sahayak?${params.toString()}`, { scroll: false });
                      }}
                      className="text-xs font-bold text-gray-500 hover:text-[#00634B]"
                    >
                      Close
                    </button>
                  </div>
                  <SahayakChatPane
                    threadId={threadId}
                    accessToken={accessToken}
                    currentUserId={user.uid}
                    peerLabel={deepLinkPeer || "Client"}
                    className="flex-1"
                  />
                </div>
              ) : chatLoading ? (
                <div className="h-full flex-1 flex items-center justify-center text-gray-400 flex-col gap-3 bg-white rounded-3xl border border-gray-100">
                  <Loader2 className="w-8 h-8 text-[#00634B] animate-spin" />
                  <p className="font-semibold text-sm">Opening chat…</p>
                </div>
              ) : !selectedCase || !chatOpen || !threadId ? (
                <div className="h-full flex-1 flex items-center justify-center text-gray-400 flex-col gap-3 bg-white rounded-3xl border border-gray-100">
                  <MessageCircle className="w-14 h-14 text-gray-100" />
                  <p className="font-semibold text-sm">Select a case to open chat</p>
                  <p className="text-xs text-gray-400 px-6 text-center">
                    Choose an accepted case from the left — then message the client.
                  </p>
                </div>
              ) : accessToken && user ? (
                <div className="flex-1 flex flex-col min-h-[50vh] bg-white rounded-3xl border border-gray-100 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-gray-100 bg-[#F8F9FA] shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCase(null);
                        setChatOpen(false);
                        setSummaryOpen(false);
                        setThreadId(null);
                        setSelectedThreadId(null);
                      }}
                      className="md:hidden text-xs font-bold text-gray-500 hover:text-[#00634B] shrink-0"
                    >
                      ← Cases
                    </button>
                    <button
                      type="button"
                      onClick={() => setSummaryOpen((v) => !v)}
                      className="flex-1 min-w-0 flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/80 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-full bg-[#00634B] text-white flex items-center justify-center shrink-0">
                        <User size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-gray-900 truncate">
                          {selectedCase.user_name || "Client"}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {selectedCase.structured_report?.incident_type || "Legal Case"}
                          {" · "}
                          Tap for case summary
                        </p>
                      </div>
                      <ChevronDown
                        size={16}
                        className={cn(
                          "text-gray-400 shrink-0 transition-transform",
                          summaryOpen && "rotate-180"
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openCasePdf(selectedCase)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold px-3 py-2 text-xs sm:text-sm shrink-0"
                    >
                      <FileDown size={14} />
                      <span className="hidden sm:inline">Case report</span>
                      <span className="sm:hidden">PDF</span>
                    </button>
                  </div>

                  {summaryOpen && (
                    <div className="px-4 py-3 border-b border-emerald-100 bg-emerald-50/50 space-y-3 overflow-y-auto max-h-[40vh] shrink-0">
                      <div>
                        <h3 className="text-[10px] font-black text-emerald-800/70 uppercase tracking-widest mb-1.5">
                          Case Summary
                        </h3>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {formatField(selectedCase.structured_report?.summary) || "No summary available."}
                        </p>
                      </div>
                      {(formatField(selectedCase.location) || formatField(selectedCase.structured_report?.location)) && (
                        <p className="text-xs text-gray-600 flex items-center gap-1.5">
                          <MapPin size={12} className="shrink-0" />
                          {formatField(selectedCase.location) || formatField(selectedCase.structured_report?.location)}
                        </p>
                      )}
                      {(selectedCase.structured_report?.statutory_sections?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedCase.structured_report?.statutory_sections?.map((sec, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1"
                            >
                              <Scale size={10} />
                              {sec}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <SahayakChatPane
                    threadId={threadId}
                    accessToken={accessToken}
                    currentUserId={user.uid}
                    peerLabel={selectedCase.user_name || "Client"}
                    className="flex-1"
                  />
                </div>
              ) : null
            ) : !selectedCase ? (
              <div className="h-full flex-1 flex items-center justify-center text-gray-400 flex-col gap-3 bg-white rounded-3xl border border-gray-100">
                <HeartHandshake className="w-14 h-14 text-gray-100" />
                <p className="font-semibold text-sm">Select a case to view details</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto min-w-0">
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="p-4 sm:p-6 bg-gradient-to-r from-blue-900 to-indigo-800 text-white">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCase(null);
                        setQueueSummaryOpen(false);
                      }}
                      className="md:hidden mb-3 text-xs font-bold text-blue-100 hover:text-white"
                    >
                      ← Back to cases
                    </button>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <span className="text-[10px] font-black px-3 py-1 rounded-full bg-white/20 border border-white/30 uppercase tracking-wide">
                          {riskLevel(selectedCase)} Risk
                        </span>
                        <h2 className="text-lg sm:text-xl font-black mt-3 leading-tight">
                          {selectedCase.structured_report?.incident_type || "Legal Case"}
                        </h2>
                        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-2 text-blue-200 text-sm">
                          <span className="flex items-center gap-1"><User size={13} /> {selectedCase.user_name}</span>
                          <span className="flex items-center gap-1">
                            <Calendar size={13} />
                            {new Date(selectedCase.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                          </span>
                        </div>
                      </div>
                      <div className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wide flex-shrink-0 ${
                        selectedCase.status === "accepted" ? "bg-emerald-500" : "bg-amber-500"
                      }`}>
                        {selectedCase.status}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-6 space-y-4">
                    <div className="rounded-2xl border border-gray-100 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setQueueSummaryOpen((v) => !v)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100/80 transition-colors text-left"
                      >
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          Case Summary
                        </span>
                        <ChevronDown
                          size={16}
                          className={cn(
                            "text-gray-400 shrink-0 transition-transform",
                            queueSummaryOpen && "rotate-180"
                          )}
                        />
                      </button>
                      {queueSummaryOpen && (
                        <div className="px-4 py-3 border-t border-gray-100 space-y-4">
                          <p className="text-sm text-gray-700 leading-relaxed">
                            {formatField(selectedCase.structured_report?.summary) || "No summary available."}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="flex items-center gap-3 text-sm text-gray-700 bg-gray-50 rounded-xl p-3 border border-gray-100">
                              <User size={14} className="text-gray-400 shrink-0" />
                              <span className="font-semibold">{selectedCase.user_name || "Anonymous"}</span>
                            </div>
                            {(formatField(selectedCase.location) || formatField(selectedCase.structured_report?.location)) && (
                              <div className="flex items-center gap-3 text-sm text-gray-700 bg-gray-50 rounded-xl p-3 border border-gray-100">
                                <MapPin size={14} className="text-gray-400 shrink-0" />
                                <span>{formatField(selectedCase.location) || formatField(selectedCase.structured_report?.location)}</span>
                              </div>
                            )}
                            {formatField(selectedCase.structured_report?.contact) && (
                              <a
                                href={`tel:${formatField(selectedCase.structured_report?.contact)}`}
                                className="flex items-center gap-3 text-sm text-blue-700 bg-blue-50 rounded-xl p-3 border border-blue-100 hover:bg-blue-100 transition-colors"
                              >
                                <Phone size={14} className="shrink-0" />
                                <span className="font-bold">{formatField(selectedCase.structured_report?.contact)}</span>
                              </a>
                            )}
                          </div>
                          {(selectedCase.structured_report?.statutory_sections?.length ?? 0) > 0 && (
                            <div>
                              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Applicable Laws</h3>
                              <div className="space-y-1.5">
                                {selectedCase.structured_report?.statutory_sections?.map((sec, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 rounded-xl p-2.5 border border-indigo-100">
                                    <Scale size={12} className="shrink-0" />
                                    <span className="font-semibold">{sec}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {(selectedCase.structured_report?.checklist?.length ?? 0) > 0 && (
                            <div>
                              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Action Checklist</h3>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {selectedCase.structured_report?.checklist?.map((item, i) => (
                                  <div key={i} className="flex items-start gap-2 text-xs text-gray-700 bg-gray-50 rounded-xl p-3 border border-gray-100">
                                    <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                                    <span>{item}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-gray-100 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                          <FileDown size={12} /> Case report PDF
                        </h3>
                        <p className="text-sm text-gray-600">
                          Download the generated case report for this help-queue case.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openCasePdf(selectedCase)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold px-4 py-2.5 text-sm flex-shrink-0"
                      >
                        <ExternalLink size={15} />
                        Download report
                      </button>
                    </div>

                    {selectedCase.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => handleAcceptCase(selectedCase)}
                        disabled={accepting}
                        className="w-full bg-blue-900 hover:bg-blue-800 text-white font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50"
                      >
                        {accepting ? <Loader2 size={16} className="animate-spin" /> : <HeartHandshake size={16} />}
                        {accepting ? "Accepting..." : "Accept & Help This Person"}
                      </button>
                    )}

                    {selectedCase.status === "accepted" && selectedCase.assigned_sahayak_id === user?.uid && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                          <div>
                            <p className="font-black text-emerald-700 text-sm">Case Accepted</p>
                            <p className="text-xs text-emerald-600">
                              Open Client Chats to message this person.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void selectChatCase(selectedCase)}
                          disabled={chatLoading || !accessToken}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold px-4 py-2.5 text-sm disabled:opacity-50 flex-shrink-0"
                        >
                          {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                          Open Client Chat
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
