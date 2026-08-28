"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Activity, Briefcase, Clock, User, Loader2 } from "lucide-react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export default function LawyerDashboard() {
  const { user, accessToken } = useAuth();
  const [counts, setCounts] = useState({ pending: 0, accepted: 0, total: 0 });
  const [threads, setThreads] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const caseRes = await fetch(`${API_URL}/api/lawyer/cases/${user.uid}`);
        const caseData = caseRes.ok ? await caseRes.json() : {};
        if (!cancelled) {
          setCounts(caseData.counts || { pending: 0, accepted: 0, total: 0 });
        }
        if (accessToken) {
          const tRes = await fetch(`${API_URL}/api/lawyer-chat/threads`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (tRes.ok) {
            const tData = await tRes.json();
            if (!cancelled) setThreads((tData.threads || []).length);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, accessToken]);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 mb-1">Lawyer Dashboard</h1>
        <p className="text-gray-500 text-sm sm:text-base">
          Welcome back, {user?.display_name || "Counsel"}. Manage cases, chats, and your public profile.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#00634B] py-8">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm font-medium">Loading overview…</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          <StatCard
            title="Total cases"
            value={String(counts.total)}
            hint="Active and pending"
            icon={Briefcase}
            tone="emerald"
          />
          <StatCard
            title="Pending requests"
            value={String(counts.pending)}
            hint="Awaiting your acceptance"
            icon={Clock}
            tone="amber"
          />
          <StatCard
            title="Active chats"
            value={String(threads)}
            hint="Client conversations"
            icon={Activity}
            tone="blue"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <ActionCard
          title="Case management"
          desc="Review new legal requests, accept pending cases, and message clients from the case dashboard."
          href="/lawyer/cases"
          cta="View client cases"
          icon={Briefcase}
        />
        <ActionCard
          title="Professional profile"
          desc="Build a LinkedIn-style public profile — practice areas, education, experience, and availability."
          href="/lawyer/profile"
          cta="Manage profile"
          icon={User}
        />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  icon: any;
  tone: "emerald" | "amber" | "blue";
}) {
  const tones = {
    emerald: "bg-[#E6F0ED] text-[#00634B]",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-sky-50 text-sky-700",
  };
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm shadow-gray-200/40">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-700">{title}</h3>
        <div className={`p-2.5 rounded-xl ${tones[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-3xl font-black text-gray-900 mb-1">{value}</p>
      <p className="text-xs text-gray-500">{hint}</p>
    </div>
  );
}

function ActionCard({
  title,
  desc,
  href,
  cta,
  icon: Icon,
}: {
  title: string;
  desc: string;
  href: string;
  cta: string;
  icon: any;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm shadow-gray-200/40">
      <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
        <Icon className="w-5 h-5 text-[#00634B]" />
        {title}
      </h3>
      <p className="text-gray-500 mb-5 text-sm leading-relaxed">{desc}</p>
      <Link
        href={href}
        className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-[#00634B] hover:bg-[#004D3C] text-white rounded-xl transition-colors text-sm font-bold"
      >
        {cta}
      </Link>
    </div>
  );
}
