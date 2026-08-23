"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { CapacityBanner, ModeratorShell } from "@/components/moderator/ModeratorShell";
import {
  fetchModeratorHistory,
  fetchModeratorStats,
  type ModeratorStats,
} from "@/lib/moderatorApi";

import { VoiceAuditPanel } from "@/components/moderator/VoiceAuditPanel";

export default function ModeratorLogs() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"interventions" | "voice">("interventions");
  const [stats, setStats] = useState<ModeratorStats | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (authLoading || !mounted) return;
    if (!user) {
      router.push("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [s, history] = await Promise.all([
          fetchModeratorStats(),
          fetchModeratorHistory(80),
        ]);
        if (cancelled) return;
        setStats(s);
        setRows(history);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load logs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, mounted, router]);

  if (!mounted || authLoading || !user) {
    return <ModeratorShell loading />;
  }

  return (
    <ModeratorShell>
      <div className="space-y-6 max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#00634B]">
              Audit
            </p>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight mt-1">
              Operations & Voice Logs
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Intervention histories, SLA respect impact, and durable voice session audit trails.
            </p>
          </div>

          {/* Tab Selector */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab("interventions")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === "interventions"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Interventions & SLA
            </button>
            <button
              onClick={() => setActiveTab("voice")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === "voice"
                  ? "bg-white text-[#00634B] shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Voice Sessions Audit
            </button>
          </div>
        </div>

        {activeTab === "voice" ? (
          <VoiceAuditPanel />
        ) : (
          <>
            {stats && (
              <CapacityBanner
                assigned={stats.assigned_in_hour}
                cap={stats.cases_per_hour}
                respect={stats.respect_score}
                overdue={stats.overdue_open}
                tickMinutes={stats.delay_tick_minutes}
              />
            )}

            {stats && (
              <div className="grid sm:grid-cols-3 gap-3">
                <Metric label="Lifetime delay points" value={String(stats.delay_score_total)} />
                <Metric label="SLA breaches" value={String(stats.cases_breached)} />
                <Metric label="Resolved" value={String(stats.cases_resolved)} />
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}

            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#00634B]" />
                <h2 className="font-black text-gray-900 text-sm">Case history</h2>
              </div>
              {!rows.length ? (
                <div className="py-16 text-center text-gray-400">
                  <ShieldAlert className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm font-semibold">No assigned history yet</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {rows.map((c) => (
                    <li key={c.case_id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 truncate">
                          {c.structured_report?.incident_type || "Legal case"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {c.case_id?.slice?.(0, 8)}… · {c.status}
                          {c.assigned_at
                            ? ` · assigned ${new Date(c.assigned_at).toLocaleString()}`
                            : ""}
                        </p>
                      </div>
                      {(c.delay_score || 0) > 0 && (
                        <span className="text-xs font-black text-rose-600 bg-rose-50 border border-rose-100 px-2 py-1 rounded-lg">
                          Delay +{c.delay_score}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg border ${
                          c.status === "pending"
                            ? "bg-amber-50 text-amber-700 border-amber-100"
                            : "bg-emerald-50 text-emerald-700 border-emerald-100"
                        }`}
                      >
                        {c.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </ModeratorShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-2xl font-black text-gray-900 mt-1">{value}</p>
    </div>
  );
}
