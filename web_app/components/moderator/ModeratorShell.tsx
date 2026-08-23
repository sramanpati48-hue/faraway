"use client";

import React from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Loader2 } from "lucide-react";

export function ModeratorShell({
  children,
  loading,
}: {
  children?: React.ReactNode;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-screen bg-[#F8F9FA] items-center justify-center">
        <Loader2 className="w-10 h-10 text-[#00634B] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F8F9FA] relative">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 md:ml-20 p-4 sm:p-6 md:p-8 overflow-x-hidden pb-28 md:pb-8">
        {children}
      </main>
    </div>
  );
}

export function CapacityBanner({
  assigned,
  cap,
  respect,
  overdue,
  tickMinutes,
}: {
  assigned: number;
  cap: number;
  respect: number;
  overdue: number;
  tickMinutes: number;
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((assigned / cap) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Hourly capacity
          </p>
          <p className="text-2xl font-black text-gray-900">
            {assigned} <span className="text-gray-400 text-lg font-bold">/ {cap}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Team respect
          </p>
          <p className="text-2xl font-black text-[#00634B]">{Math.round(respect)}</p>
        </div>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct >= 100 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-[#00634B]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {overdue > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 font-semibold">
          Delay score is increasing every {tickMinutes} minutes on {overdue} overdue case
          {overdue === 1 ? "" : "s"}. This affects your respect with the team.
        </div>
      )}
    </div>
  );
}
