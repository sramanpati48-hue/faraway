"use client";

import React, { useEffect, useState } from "react";
import {
  Mic,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Clock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  FileText,
  User,
  Bot,
  Scale,
  Sparkles,
  Lock,
} from "lucide-react";
import {
  fetchVoiceSessionAudits,
  fetchVoiceSessionAuditDetail,
  type VoiceSessionAuditItem,
} from "@/lib/moderatorApi";

export function VoiceAuditPanel() {
  const [sessions, setSessions] = useState<VoiceSessionAuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionDetails, setSessionDetails] = useState<Record<string, VoiceSessionAuditItem>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await fetchVoiceSessionAudits(60, 0);
        if (!cancelled) setSessions(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load voice audit data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleExpand = async (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sessionId);

    // If detail not already cached, fetch it
    if (!sessionDetails[sessionId]) {
      try {
        setLoadingDetailId(sessionId);
        const detail = await fetchVoiceSessionAuditDetail(sessionId);
        setSessionDetails((prev) => ({ ...prev, [sessionId]: detail }));
      } catch (err: any) {
        console.error("Failed to load audit detail:", err);
      } finally {
        setLoadingDetailId(null);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Completed
          </span>
        );
      case "escalate":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border bg-rose-50 text-rose-700 border-rose-200">
            <ShieldAlert className="w-3 h-3" /> Escalated
          </span>
        );
      case "verified":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border bg-teal-50 text-teal-700 border-teal-200">
            <Scale className="w-3 h-3" /> Verified
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border bg-amber-50 text-amber-700 border-amber-200">
            <Activity className="w-3 h-3 animate-pulse" /> In Progress
          </span>
        );
    }
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-gray-50/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#00634B]/10 flex items-center justify-center text-[#00634B]">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-black text-gray-900 text-sm">Voice Moderator Sessions</h2>
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-[#00634B] flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Audit Data
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Read-only auditable records of case-scoped AI voice interactions and sub-agent decisions.
            </p>
          </div>
        </div>
        <div className="text-xs text-gray-400 font-medium">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} recorded
        </div>
      </div>

      {error && (
        <div className="p-4 m-4 rounded-xl border border-rose-200 bg-rose-50 text-sm text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400">
          <div className="w-7 h-7 border-2 border-[#00634B] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs font-semibold">Loading audit logs...</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <Mic className="w-10 h-10 mx-auto mb-2 text-gray-200" />
          <p className="text-sm font-semibold">No voice sessions recorded yet</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Voice sessions appear here once citizens invoke the Voice Moderator in New Case.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sessions.map((item) => {
            const isExpanded = expandedId === item.id;
            const detail = sessionDetails[item.id] || item;
            const flags = (item.risk_flags || []).filter(Boolean);

            return (
              <li key={item.id} className="transition-colors hover:bg-gray-50/60">
                {/* Summary Row */}
                <div
                  onClick={() => handleToggleExpand(item.id)}
                  className="px-5 py-4 cursor-pointer flex flex-wrap items-center justify-between gap-3 select-none"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-gray-900 text-sm">
                        {item.incident_type || "Legal Case"}
                      </span>
                      <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        Case #{item.case_id?.slice(0, 8)}…
                      </span>
                      {getStatusBadge(item.resolution_status)}
                      {item.escalated && (
                        <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                          Handoff: {item.escalation_reason || "Escalated"}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        {new Date(item.started_at).toLocaleString()}
                      </span>
                      {item.confidence_score !== undefined && item.confidence_score !== null && (
                        <span className="flex items-center gap-1">
                          <Activity className="w-3.5 h-3.5 text-gray-400" />
                          Confidence:{" "}
                          <strong className="text-gray-700">
                            {Math.round(item.confidence_score * 100)}%
                          </strong>
                        </span>
                      )}
                      {flags.length > 0 && (
                        <div className="flex items-center gap-1">
                          {flags.map((f, i) => (
                            <span
                              key={i}
                              className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title={isExpanded ? "Collapse" : "Expand audit details"}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Audit Detail Panel */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 bg-gray-50/80 border-t border-gray-100 space-y-4">
                    {loadingDetailId === item.id ? (
                      <div className="py-6 text-center text-gray-400 text-xs">
                        <div className="w-5 h-5 border-2 border-[#00634B] border-t-transparent rounded-full animate-spin mx-auto mb-1" />
                        Loading session transcript and decision log...
                      </div>
                    ) : (
                      <>
                        {/* Audit Metadata Banner */}
                        <div className="grid sm:grid-cols-3 gap-2.5 text-xs">
                          <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                            <span className="text-[10px] font-black uppercase text-gray-400">Session ID</span>
                            <p className="font-mono text-gray-700 truncate mt-0.5">{item.id}</p>
                          </div>
                          <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                            <span className="text-[10px] font-black uppercase text-gray-400">Duration</span>
                            <p className="font-semibold text-gray-700 mt-0.5">
                              {item.ended_at
                                ? `${Math.max(1, Math.round((new Date(item.ended_at).getTime() - new Date(item.started_at).getTime()) / 1000))}s`
                                : "Active / Ended cleanly"}
                            </p>
                          </div>
                          <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                            <span className="text-[10px] font-black uppercase text-gray-400">Confidence Curve</span>
                            <p className="font-semibold text-gray-700 mt-0.5">
                              {(detail.confidence_score_history || []).length > 0
                                ? detail.confidence_score_history
                                    ?.map((h) => `${Math.round(h.score * 100)}%`)
                                    .join(" → ")
                                : `${Math.round((item.confidence_score || 0.5) * 100)}%`}
                            </p>
                          </div>
                        </div>

                        {/* Agent Decision Log */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <Sparkles className="w-3.5 h-3.5 text-[#00634B]" />
                            <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider">
                              Sub-Agent Decision Log (Audit Trail)
                            </h3>
                          </div>
                          {(!detail.agent_decision_log || detail.agent_decision_log.length === 0) ? (
                            <div className="bg-white p-3 rounded-xl border border-gray-100 text-xs text-gray-400">
                              No discrete agent decisions recorded.
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {detail.agent_decision_log.map((d, idx) => (
                                <div
                                  key={idx}
                                  className="bg-white p-3 rounded-xl border border-gray-100 text-xs flex flex-wrap items-start justify-between gap-2"
                                >
                                  <div className="space-y-0.5 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-gray-900">{d.agent}</span>
                                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-[#00634B]">
                                        {d.decision}
                                      </span>
                                    </div>
                                    <p className="text-gray-600 text-xs">{d.reason}</p>
                                  </div>
                                  {d.timestamp && (
                                    <span className="text-[10px] text-gray-400 shrink-0">
                                      {new Date(d.timestamp * 1000).toLocaleTimeString()}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Transcript */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <FileText className="w-3.5 h-3.5 text-[#00634B]" />
                            <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider">
                              Spoken Transcript Record
                            </h3>
                          </div>
                          {(!detail.full_transcript || detail.full_transcript.length === 0) ? (
                            <div className="bg-white p-3 rounded-xl border border-gray-100 text-xs text-gray-400">
                              No spoken turns in this session.
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                              {detail.full_transcript.map((t, idx) => {
                                const isUser = t.role === "user";
                                return (
                                  <div
                                    key={idx}
                                    className={`p-3 rounded-xl text-xs flex items-start gap-2.5 ${
                                      isUser
                                        ? "bg-emerald-50/80 border border-emerald-100 text-emerald-950 ml-6"
                                        : "bg-white border border-gray-100 text-gray-900 mr-6"
                                    }`}
                                  >
                                    <div
                                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                                        isUser
                                          ? "bg-[#00634B] text-white"
                                          : "bg-gray-100 text-gray-600"
                                      }`}
                                    >
                                      {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-bold text-[11px]">
                                          {isUser ? "Citizen" : t.agent || "AI Voice Moderator"}
                                        </span>
                                        {t.timestamp && (
                                          <span className="text-[10px] text-gray-400">
                                            {new Date(t.timestamp * 1000).toLocaleTimeString()}
                                          </span>
                                        )}
                                      </div>
                                      <p className="whitespace-pre-wrap leading-relaxed">{t.text}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
