"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Clock,
  ListChecks,
  Loader2,
  Shield,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { CapacityBanner, ModeratorShell } from "@/components/moderator/ModeratorShell";
import { fetchModeratorStats, type ModeratorStats } from "@/lib/moderatorApi";

export default function ModeratorOverview() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<ModeratorStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (authLoading || !mounted) return;
    if (!user) {
      router.push("/login");
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const s = await fetchModeratorStats();
        if (!cancelled) setStats(s);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load");
      }
    };
    void load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user, authLoading, mounted, router]);

  if (!mounted || authLoading || !user) {
    return <ModeratorShell loading />;
  }

  return (
    <ModeratorShell>
      <div className="space-y-6 max-w-5xl animate-in fade-in duration-500">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#00634B]">
            Moderator ops
          </p>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight mt-1">
            Operations overview
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Exclusive assignments, hourly capacity, and SLA respect scoring.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {!stats ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-[#00634B] animate-spin" />
          </div>
        ) : (
          <>
            <CapacityBanner
              assigned={stats.assigned_in_hour}
              cap={stats.cases_per_hour}
              respect={stats.respect_score}
              overdue={stats.overdue_open}
              tickMinutes={stats.delay_tick_minutes}
            />

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                icon={ListChecks}
                label="Open in queue"
                value={String(stats.open_pending)}
              />
              <StatCard
                icon={Clock}
                label="SLA window"
                value={`${stats.sla_minutes}m`}
              />
              <StatCard
                icon={Shield}
                label="Cases resolved"
                value={String(stats.cases_resolved)}
              />
              <StatCard
                icon={AlertTriangle}
                label="Lifetime breaches"
                value={String(stats.cases_breached)}
                tone={stats.cases_breached > 0 ? "warn" : "ok"}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Link
                href="/moderator/queue"
                className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:border-[#00634B]/40 transition-colors"
              >
                <Activity className="w-5 h-5 text-[#00634B] mb-3" />
                <p className="font-black text-gray-900">Review queue</p>
                <p className="text-sm text-gray-500 mt-1">
                  Work exclusively assigned cases with agent report side-by-side.
                </p>
              </Link>
              <Link
                href="/moderator/logs"
                className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:border-[#00634B]/40 transition-colors"
              >
                <Shield className="w-5 h-5 text-[#00634B] mb-3" />
                <p className="font-black text-gray-900">Audit logs</p>
                <p className="text-sm text-gray-500 mt-1">
                  Delay scores, respect history, and resolved interventions.
                </p>
              </Link>
            </div>
          </>
        )}
      </div>
    </ModeratorShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "ok",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-gray-400 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <p
        className={`text-2xl font-black ${
          tone === "warn" ? "text-amber-600" : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
