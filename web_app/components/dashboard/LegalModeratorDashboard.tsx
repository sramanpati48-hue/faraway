"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckSquare,
  FileDown,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Send,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { CapacityBanner, ModeratorShell } from "@/components/moderator/ModeratorShell";
import {
  fetchMyInterventions,
  resolveIntervention,
  type ModeratorStats,
} from "@/lib/moderatorApi";

interface StructuredReport {
  incident_type: string;
  risk_level: string;
  summary: string;
  statutory_sections: string[];
  checklist: string[];
}

interface RoutingRecommendation {
  issue_type?: string;
  state?: string;
  primary_forum?: string;
  secondary_forum?: string;
  routing_message?: string;
  links?: Record<string, string>;
}

interface ModeratorOption {
  label: string;
  payload: string;
  type?: string;
  routing_recommendation?: RoutingRecommendation;
}

interface CasePayload {
  case_id: string;
  user_id: string;
  incident_type: string;
  risk_level: string;
  status?: string;
  session_id?: string;
  pdf_url?: string | null;
  structured_report: StructuredReport;
  timestamp: number;
  collection: string;
  user_statement: string;
  location: { city?: string; state?: string; lat?: number; lon?: number };
  routing_recommendation?: RoutingRecommendation | null;
  delay_score?: number;
  sla_breached_at?: string | null;
  assigned_at?: string | null;
  agent_summary?: string;
  agent_chat_response?: string;
  agent_suggested_actions?: unknown[];
  agent_suggested_links?: unknown[];
  agent_flags?: Record<string, unknown>;
}

function asOptions(raw: unknown): ModeratorOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return { label: item, payload: item };
      const o = (item || {}) as Record<string, unknown>;
      const label = String(o.label || o.payload || "").trim();
      if (!label) return null;
      return {
        label,
        payload: String(o.payload || o.label || label),
        type: typeof o.type === "string" ? o.type : undefined,
      };
    })
    .filter((o): o is ModeratorOption => Boolean(o));
}

function linksToLines(links: unknown): string {
  if (!Array.isArray(links)) return "";
  return links
    .map((item) => {
      if (typeof item === "string") return item;
      const o = (item || {}) as Record<string, unknown>;
      const label = String(o.label || o.title || "").trim();
      const url = String(o.url || o.href || "").trim();
      if (label && url) return `${label} | ${url}`;
      return url || label;
    })
    .filter(Boolean)
    .join("\n");
}

function linesToLinks(text: string): { label: string; url: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("|")) {
        const [label, ...rest] = line.split("|");
        const url = rest.join("|").trim();
        return { label: label.trim() || url, url: url || label.trim() };
      }
      return { label: line, url: line };
    });
}

function flagChips(flags?: Record<string, unknown>) {
  if (!flags) return [];
  return Object.entries(flags)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`);
}

function mapCase(c: any): CasePayload {
  return {
    case_id: c.case_id,
    user_id: c.user_id || "unknown",
    incident_type: c.structured_report?.incident_type || c.incident_type || "Unknown",
    risk_level: c.structured_report?.risk_level || c.risk_level || "Medium",
    status: c.status || "pending",
    session_id: c.session_id,
    pdf_url: c.pdf_url || c.structured_report?.pdf_url || null,
    structured_report: c.structured_report || {},
    timestamp: c.assigned_at
      ? new Date(c.assigned_at).getTime()
      : c.created_at
        ? new Date(c.created_at).getTime()
        : c.timestamp || Date.now(),
    collection: "moderator",
    user_statement: c.user_statement || "",
    location: c.location || {},
    routing_recommendation: c.routing_recommendation || null,
    delay_score: Number(c.delay_score || 0),
    sla_breached_at: c.sla_breached_at || null,
    assigned_at: c.assigned_at || null,
    agent_summary: c.agent_summary || c.structured_report?.summary || "",
    agent_chat_response: c.agent_chat_response || "",
    agent_suggested_actions: c.agent_suggested_actions || [],
    agent_suggested_links: c.agent_suggested_links || [],
    agent_flags: c.agent_flags || {},
  };
}

export default function LegalModeratorDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [cases, setCases] = useState<CasePayload[]>([]);
  const [stats, setStats] = useState<ModeratorStats | null>(null);
  const [selectedCase, setSelectedCase] = useState<CasePayload | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [slaWarning, setSlaWarning] = useState<string | null>(null);

  const [moderatorResponse, setModeratorResponse] = useState(
    "Based on my review, here are the immediate next steps you should take:"
  );
  const [moderatorSummary, setModeratorSummary] = useState("");
  const [moderatorNotes, setModeratorNotes] = useState("");
  const [moderatorLinks, setModeratorLinks] = useState("");
  const [options, setOptions] = useState<ModeratorOption[]>([
    { label: "Connect to Nyay Guide", payload: "Request Human Help" },
    { label: "Acknowledge & Proceed", payload: "I understand, please continue" },
  ]);
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [includeRoutingRecommendation, setIncludeRoutingRecommendation] = useState(true);
  const [reviewOutcome, setReviewOutcome] = useState("approved_for_next_step");
  const [nyayguideSupport, setNyayguideSupport] = useState(false);
  const [assistanceType, setAssistanceType] = useState("complaint_filing_support");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (authLoading || !mounted) return;
    if (!user) {
      router.push("/login");
      return;
    }

    const load = async () => {
      try {
        const data = await fetchMyInterventions();
        const active = (data.cases || []).map(mapCase);
        const seen = new Set<string>();
        setCases(active.filter((c) => !seen.has(c.case_id) && seen.add(c.case_id)));
        if (data.stats) setStats(data.stats);
      } catch (err) {
        console.error("Failed to fetch interventions", err);
      }
    };
    void load();

    const wsBaseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(
      /^http/,
      "ws"
    );
    let wsDestroyed = false;
    let wsReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket;

    const connectModeratorWS = () => {
      if (wsDestroyed) return;
      ws = new WebSocket(`${wsBaseUrl}/ws/moderator`);
      ws.onopen = () => {
        try {
          ws.send(
            JSON.stringify({
              type: "identify",
              uid: user.uid,
              role: "moderator",
              open_cases: cases.length,
            })
          );
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "intervention_sla_warning") {
            setSlaWarning(data.message || "Delay score is increasing.");
            setCases((prev) =>
              prev.map((c) =>
                c.case_id === data.case_id
                  ? { ...c, delay_score: data.delay_score ?? c.delay_score }
                  : c
              )
            );
            if (typeof data.respect_score === "number") {
              setStats((prev) =>
                prev ? { ...prev, respect_score: data.respect_score } : prev
              );
            }
            return;
          }
          if (data.type === "new_intervention" && data.collection === "moderator") {
            const newCase = mapCase(data);
            setCases((prev) => {
              if (prev.find((c) => c.case_id === newCase.case_id)) return prev;
              return [newCase, ...prev];
            });
            void load();
          } else if (data.type === "intervention_updated" && data.collection === "moderator") {
            const updated = mapCase(data);
            setCases((prev) => {
              const idx = prev.findIndex((c) => c.case_id === updated.case_id);
              if (idx === -1) return [updated, ...prev];
              const next = [...prev];
              next[idx] = { ...next[idx], ...updated };
              return next;
            });
          } else if (data.type === "intervention_resolved" && data.collection === "moderator") {
            setCases((prev) => prev.filter((c) => c.case_id !== data.case_id));
            setSelectedCase((prev) => (prev?.case_id === data.case_id ? null : prev));
            void load();
          }
        } catch (e) {
          console.error("WebSocket message parsing error", e);
        }
      };
      ws.onclose = () => {
        if (!wsDestroyed) wsReconnectTimeout = setTimeout(connectModeratorWS, 3000);
      };
    };

    connectModeratorWS();
    const pollId = window.setInterval(load, 20000);

    return () => {
      wsDestroyed = true;
      window.clearInterval(pollId);
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, mounted, router]);

  useEffect(() => {
    if (!selectedCase) return;
    setIncludeRoutingRecommendation(Boolean(selectedCase.routing_recommendation));
    setModeratorSummary(selectedCase.agent_summary || selectedCase.structured_report?.summary || "");
    setModeratorResponse(
      selectedCase.agent_chat_response ||
        "Based on my review, here are the immediate next steps you should take:"
    );
    setModeratorNotes("");
    setModeratorLinks(linksToLines(selectedCase.agent_suggested_links));
    const fromAgent = asOptions(selectedCase.agent_suggested_actions);
    if (fromAgent.length > 0) setOptions(fromAgent);
    setReviewOutcome("approved_for_next_step");
    setNyayguideSupport(false);
    setAssistanceType("complaint_filing_support");
  }, [selectedCase]);

  const handleResolve = async () => {
    if (!selectedCase || !user) return;
    setIsResolving(true);
    try {
      await resolveIntervention({
        case_id: selectedCase.case_id,
        moderator_response: moderatorResponse,
        moderator_options: options,
        routing_recommendation: includeRoutingRecommendation
          ? selectedCase.routing_recommendation || null
          : null,
        moderator_id: user.uid,
        moderator_summary: moderatorSummary,
        moderator_notes: moderatorNotes,
        moderator_report: {
          ...(selectedCase.structured_report || {}),
          summary: moderatorSummary,
        },
        moderator_suggested_links: linesToLinks(moderatorLinks),
        review_outcome:
          nyayguideSupport && reviewOutcome === "approved_for_next_step"
            ? "nyayguide_recommended"
            : reviewOutcome,
        nyayguide_support_needed: reviewOutcome === "unable_to_verify" ? false : nyayguideSupport,
        nyayguide_assistance_type: nyayguideSupport ? assistanceType : undefined,
      });
      setCases((prev) => prev.filter((c) => c.case_id !== selectedCase.case_id));
      setSelectedCase(null);
      setModeratorResponse(
        "Based on my review, here are the immediate next steps you should take:"
      );
      setModeratorSummary("");
      setModeratorNotes("");
      setModeratorLinks("");
      setIncludeRoutingRecommendation(true);
      const data = await fetchMyInterventions();
      if (data.stats) setStats(data.stats);
    } catch (err) {
      console.error("Error resolving case:", err);
      alert("Failed to submit resolution. Please try again.");
    } finally {
      setIsResolving(false);
    }
  };

  const addOption = () => {
    if (!newOptionLabel.trim()) return;
    setOptions((prev) => [
      ...prev,
      { label: newOptionLabel.trim(), payload: newOptionLabel.trim() },
    ]);
    setNewOptionLabel("");
  };

  const appendRoutingMessage = () => {
    if (!selectedCase?.routing_recommendation?.routing_message) return;
    const msg = selectedCase.routing_recommendation.routing_message.trim();
    setModeratorResponse((prev) => {
      if (prev.includes(msg)) return prev;
      return `${prev.trim()}\n\n${msg}`.trim();
    });
  };

  const removeOption = (idx: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  if (!mounted || authLoading || !user) {
    return <ModeratorShell loading />;
  }

  const overdue = cases.filter((c) => (c.delay_score || 0) > 0 || c.sla_breached_at).length;

  return (
    <ModeratorShell>
      <div className="space-y-4 max-w-[1400px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#00634B]">
              Review queue
            </p>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Assigned interventions
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Cases exclusively assigned to you under the hourly capacity cap.
            </p>
          </div>
        </div>

        {stats && (
          <CapacityBanner
            assigned={stats.assigned_in_hour}
            cap={stats.cases_per_hour}
            respect={stats.respect_score}
            overdue={Math.max(overdue, stats.overdue_open)}
            tickMinutes={stats.delay_tick_minutes}
          />
        )}

        {(slaWarning || overdue > 0) && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
            {slaWarning ||
              `Delay score is increasing every ${stats?.delay_tick_minutes || 5} minutes. This affects your respect with the team.`}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-4 min-h-[70vh] rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="w-full lg:w-[340px] xl:w-[380px] border-b lg:border-b-0 lg:border-r border-gray-100 flex flex-col max-h-[40vh] lg:max-h-none">
            <div className="p-4 border-b border-gray-100 bg-[#0B3D2E] text-white">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5" />
                <h2 className="font-black">My queue</h2>
              </div>
              <p className="text-emerald-100 text-xs mt-1">
                {cases.length} case{cases.length === 1 ? "" : "s"} assigned
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {cases.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 py-12 px-4 text-center">
                  <ShieldAlert className="w-10 h-10 mb-3 text-gray-200" />
                  <p className="font-bold text-gray-500">Queue is empty</p>
                  <p className="text-xs mt-2">
                    New leads are assigned evenly when you are under capacity and online.
                  </p>
                </div>
              ) : (
                cases.map((c) => (
                  <button
                    type="button"
                    key={c.case_id}
                    onClick={() => setSelectedCase(c)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selectedCase?.case_id === c.case_id
                        ? "border-[#00634B] bg-[#E6F0ED] shadow-sm"
                        : "border-gray-100 hover:border-gray-200"
                    }`}
                  >
                    <div className="flex justify-between gap-2 mb-1">
                      <p className="font-bold text-gray-900 truncate">{c.incident_type}</p>
                      <span
                        className={`text-[10px] font-black px-1.5 py-0.5 rounded border uppercase ${
                          String(c.risk_level).toLowerCase() === "high"
                            ? "bg-red-50 text-red-700 border-red-100"
                            : "bg-amber-50 text-amber-700 border-amber-100"
                        }`}
                      >
                        {c.risk_level}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <User size={11} />
                        {(c.user_id || "").slice(0, 8)}…
                      </span>
                      {(c.delay_score || 0) > 0 ? (
                        <span className="font-black text-rose-600">
                          Delay +{c.delay_score}
                        </span>
                      ) : (
                        <span>{new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
            {selectedCase ? (
              <div className="space-y-5 max-w-6xl">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="text-[#00634B] shrink-0" size={20} />
                    <h2 className="text-xl font-black text-gray-900">Review comparison</h2>
                  </div>
                  {(selectedCase.delay_score || 0) > 0 && (
                    <span className="text-xs font-black text-rose-600 bg-rose-50 border border-rose-100 px-2 py-1 rounded-lg">
                      Delay score {selectedCase.delay_score}
                    </span>
                  )}
                  {selectedCase.pdf_url && (
                    <a
                      href={selectedCase.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-bold"
                    >
                      <FileDown size={15} /> View PDF
                    </a>
                  )}
                </div>

                {selectedCase.user_statement && (
                  <div>
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                      <MessageSquare size={11} /> Victim statement
                    </h3>
                    <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-xl p-3 italic">
                      &ldquo;{selectedCase.user_statement}&rdquo;
                    </p>
                  </div>
                )}

                {(selectedCase.location?.city || selectedCase.location?.state) && (
                  <p className="text-sm text-gray-600 flex items-center gap-1.5 font-semibold">
                    <MapPin size={14} className="text-[#00634B]" />
                    {[selectedCase.location.city, selectedCase.location.state]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-gray-100 bg-[#F8F9FA] p-5 space-y-4">
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">
                      Agent snapshot
                    </h3>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Summary
                      </p>
                      <p className="text-sm text-gray-800 font-medium leading-relaxed whitespace-pre-wrap">
                        {selectedCase.agent_summary ||
                          selectedCase.structured_report?.summary ||
                          "No summary captured."}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Chat response
                      </p>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-white border border-gray-100 rounded-xl p-3">
                        {selectedCase.agent_chat_response || "No chat response stored."}
                      </p>
                    </div>
                    {(selectedCase.structured_report?.checklist?.length || 0) > 0 && (
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                          <CheckSquare size={11} /> Report checklist
                        </p>
                        <ul className="space-y-1.5">
                          {selectedCase.structured_report.checklist.map((step, i) => (
                            <li key={i} className="text-sm text-gray-700 flex gap-2">
                              <span className="w-5 h-5 rounded-full bg-[#E6F0ED] text-[#00634B] text-[10px] font-black flex items-center justify-center flex-shrink-0">
                                {i + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                        Suggested actions
                      </p>
                      {asOptions(selectedCase.agent_suggested_actions).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {asOptions(selectedCase.agent_suggested_actions).map((opt, i) => (
                            <span
                              key={i}
                              className="bg-white border border-gray-200 text-gray-700 px-2.5 py-1 rounded-lg text-xs font-bold"
                            >
                              {opt.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">None.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                        Suggested links
                      </p>
                      {linksToLines(selectedCase.agent_suggested_links) ? (
                        <p className="text-xs text-gray-700 whitespace-pre-wrap">
                          {linksToLines(selectedCase.agent_suggested_links)}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">None.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                        Flags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedCase.structured_report?.statutory_sections || []).map((sec, i) => (
                          <span
                            key={`sec-${i}`}
                            className="bg-white border border-gray-200 text-gray-700 px-2.5 py-1 rounded-lg text-xs font-bold"
                          >
                            {sec}
                          </span>
                        ))}
                        {flagChips(selectedCase.agent_flags).map((chip) => (
                          <span
                            key={chip}
                            className="bg-amber-50 border border-amber-100 text-amber-800 px-2.5 py-1 rounded-lg text-xs font-bold"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#00634B]/20 bg-white p-5 space-y-4 shadow-sm">
                    <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                      <Send size={18} className="text-[#00634B]" /> Moderator revision
                    </h2>

                    <div>
                      <label className="text-xs font-black text-gray-600 block mb-1.5">
                        Summary
                      </label>
                      <textarea
                        value={moderatorSummary}
                        onChange={(e) => setModeratorSummary(e.target.value)}
                        className="w-full bg-[#F8F9FA] border border-gray-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-[#00634B]/30 text-sm resize-none"
                        rows={3}
                      />
                    </div>

                    <div>
                      <label className="text-xs font-black text-gray-600 block mb-1.5">
                        Message to victim
                      </label>
                      <textarea
                        value={moderatorResponse}
                        onChange={(e) => setModeratorResponse(e.target.value)}
                        className="w-full bg-[#F8F9FA] border border-gray-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-[#00634B]/30 text-sm resize-none"
                        rows={5}
                      />
                    </div>

                    <div>
                      <label className="text-xs font-black text-gray-600 block mb-1.5">
                        Review outcome
                      </label>
                      <select
                        value={reviewOutcome}
                        onChange={(e) => setReviewOutcome(e.target.value)}
                        className="w-full bg-[#F8F9FA] border border-gray-200 p-2.5 rounded-xl outline-none focus:ring-2 focus:ring-[#00634B]/30 text-sm"
                      >
                        <option value="approved_for_next_step">Approve for next step (digital guidance)</option>
                        <option value="nyayguide_recommended">Approve — NyayGuide support recommended</option>
                        <option value="unable_to_verify">Unable to verify / reject</option>
                      </select>
                    </div>

                    {reviewOutcome !== "unable_to_verify" && (
                      <div className="rounded-xl border border-[#00634B]/20 bg-[#00634B]/5 p-3 space-y-2">
                        <label className="flex items-center gap-2 text-xs font-bold text-[#0B3D2E]">
                          <input
                            type="checkbox"
                            checked={nyayguideSupport}
                            onChange={(e) => setNyayguideSupport(e.target.checked)}
                          />
                          On-ground NyayGuide support is needed
                        </label>
                        {nyayguideSupport && (
                          <select
                            value={assistanceType}
                            onChange={(e) => setAssistanceType(e.target.value)}
                            className="w-full bg-white border border-gray-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-[#00634B]/30 text-sm"
                          >
                            <option value="complaint_filing_support">Complaint filing support</option>
                            <option value="document_support">Document support</option>
                            <option value="office_navigation">Office navigation</option>
                            <option value="digital_assistance">Digital assistance</option>
                          </select>
                        )}
                        <p className="text-[11px] text-gray-500">
                          Approving the case does not automatically enable NyayGuide. The citizen always confirms before any request is sent.
                        </p>
                      </div>
                    )}

                    {selectedCase.routing_recommendation && (
                      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold text-sky-900">
                            Route: {selectedCase.routing_recommendation.primary_forum || "Official"}
                          </p>
                          <button
                            type="button"
                            onClick={appendRoutingMessage}
                            className="px-2.5 py-1.5 rounded-lg bg-sky-800 text-white text-xs font-bold"
                          >
                            Add route message
                          </button>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-sky-900">
                          <input
                            type="checkbox"
                            checked={includeRoutingRecommendation}
                            onChange={(e) => setIncludeRoutingRecommendation(e.target.checked)}
                          />
                          Include routing bundle for the user
                        </label>
                      </div>
                    )}

                    <div>
                      <label className="text-xs font-black text-gray-600 block mb-1.5">
                        Suggested actions
                      </label>
                      <div className="space-y-2 mb-2">
                        {options.map((opt, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 bg-[#F8F9FA] border border-gray-100 px-3 py-2 rounded-xl"
                          >
                            <span className="flex-1 text-sm font-bold text-gray-700">{opt.label}</span>
                            <button
                              type="button"
                              onClick={() => removeOption(idx)}
                              className="p-1.5 text-gray-400 hover:text-rose-500"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newOptionLabel}
                          onChange={(e) => setNewOptionLabel(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addOption()}
                          placeholder="Add option label"
                          className="flex-1 bg-[#F8F9FA] border border-gray-200 px-3 py-2 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[#00634B]/30"
                        />
                        <button
                          type="button"
                          onClick={addOption}
                          disabled={!newOptionLabel.trim()}
                          className="bg-gray-900 text-white px-3 rounded-xl font-bold text-sm disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <Plus size={14} /> Add
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-black text-gray-600 block mb-1.5">
                        Suggested links (label | url)
                      </label>
                      <textarea
                        value={moderatorLinks}
                        onChange={(e) => setModeratorLinks(e.target.value)}
                        className="w-full bg-[#F8F9FA] border border-gray-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-[#00634B]/30 text-sm resize-none font-mono"
                        rows={3}
                        placeholder="NCRP | https://cybercrime.gov.in"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-black text-gray-600 block mb-1.5">
                        Moderator notes
                      </label>
                      <textarea
                        value={moderatorNotes}
                        onChange={(e) => setModeratorNotes(e.target.value)}
                        className="w-full bg-[#F8F9FA] border border-gray-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-[#00634B]/30 text-sm resize-none"
                        rows={3}
                        placeholder="Internal notes for this review (not shown to the user)"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleResolve}
                      disabled={isResolving || !moderatorResponse.trim() || options.length === 0}
                      className="w-full bg-[#00634B] hover:bg-[#004D3C] text-white font-black py-3.5 rounded-xl transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      {isResolving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                        </>
                      ) : (
                        <>
                          Mark completed <Send size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-gray-400">
                <ShieldAlert className="w-12 h-12 text-gray-200 mb-3" />
                <p className="font-bold text-gray-500">Select a case to review</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModeratorShell>
  );
}
