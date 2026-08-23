"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Scale, X, ChevronLeft, ChevronRight } from "lucide-react";
import { LawyerListCard } from "@/components/lawyer/LawyerListCard";
import { LawyerProfileSheet } from "@/components/lawyer/LawyerProfileSheet";
import type { LawyerProfile } from "@/lib/lawyerTypes";
import { lawyerIdOf, normalizeLawyerProfile } from "@/lib/lawyerTypes";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

export type { LawyerProfile };

const PAGE_SIZE = 5;

interface LawyerBrowserPanelProps {
  lawyers: LawyerProfile[];
  lawyerCaseId?: string | null;
  /** Practice-area / case category shown in the header */
  category?: string | null;
  loading?: boolean;
  onClose: () => void;
  onAccept: (lawyer: LawyerProfile) => void | Promise<void>;
  onReject: (lawyer: LawyerProfile) => void;
  /** Full-screen sheet on mobile, centered dialog on desktop (default). */
  presentation?: "modal" | "embedded";
}

export function LawyerBrowserPanel({
  lawyers,
  lawyerCaseId,
  category,
  loading = false,
  onClose,
  onAccept,
  onReject,
  presentation = "modal",
}: LawyerBrowserPanelProps) {
  const { user, accessToken } = useAuth();
  const normalized = useMemo(
    () => (lawyers || []).map((l) => normalizeLawyerProfile(l as any)),
    [lawyers]
  );
  const [page, setPage] = useState(0);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<LawyerProfile | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setPage(0);
  }, [lawyers]);

  useEffect(() => {
    if (presentation !== "modal") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [presentation, onClose]);

  const available = normalized.filter((l) => !rejected.has(lawyerIdOf(l)));
  const pageCount = Math.max(1, Math.ceil(available.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = available.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const categoryLabel = (category || "").trim() || "your case category";

  const openProfile = (lawyer: LawyerProfile) => {
    setSelected(lawyer);
    setSheetOpen(true);
  };

  const handleReject = (lawyer: LawyerProfile) => {
    const id = lawyerIdOf(lawyer);
    setRejected((prev) => new Set([...prev, id]));
    onReject(lawyer);
    if (selected && lawyerIdOf(selected) === id) {
      setSheetOpen(false);
      setSelected(null);
    }
  };

  const panel = (
    <div
      role={presentation === "modal" ? "dialog" : undefined}
      aria-modal={presentation === "modal" ? true : undefined}
      aria-label="Browse lawyers"
      className={cn(
        "relative flex flex-col overflow-hidden bg-white dark:bg-slate-900",
        presentation === "modal"
          ? "h-[min(92dvh,40rem)] w-full max-w-lg rounded-t-2xl shadow-[0_24px_60px_-16px_rgba(15,23,42,0.55)] sm:h-[min(85vh,36rem)] sm:rounded-2xl md:max-w-xl"
          : "h-full border-l border-gray-100 dark:border-slate-700"
      )}
    >
      <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-[#E6F0ED] to-white px-4 py-3.5 sm:px-5 sm:py-4 dark:border-slate-700 dark:from-emerald-950/40 dark:to-slate-900">
        <div className="min-w-0">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#00634B] ring-1 ring-[#00634B]/15 dark:bg-slate-800 dark:text-emerald-300">
            <Scale className="h-3 w-3" />
            Matched lawyers
          </div>
          <h2 className="truncate text-[15px] font-black tracking-tight text-[#00634B] dark:text-emerald-300 sm:text-base">
            {categoryLabel}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
            {loading
              ? "Finding advocates for your case…"
              : `${available.length} available · tap a card for fees & connect`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close lawyer browser"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800"
        >
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {loading && available.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-4 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#00634B]" />
            <p className="text-sm text-gray-500">Matching lawyers to {categoryLabel}…</p>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center px-4 text-center">
            <p className="text-sm text-gray-500">
              No more lawyers in this list. Try Find Help for a wider search.
            </p>
          </div>
        ) : (
          pageItems.map((lawyer) => (
            <div key={lawyerIdOf(lawyer)} className="space-y-1">
              <LawyerListCard lawyer={lawyer} onClick={() => openProfile(lawyer)} />
              <button
                type="button"
                onClick={() => handleReject(lawyer)}
                className="w-full py-2 text-[11px] font-bold text-gray-400 hover:text-red-500"
              >
                Not a good fit
              </button>
            </div>
          ))
        )}
      </div>

      {available.length > PAGE_SIZE && (
        <div className="flex flex-shrink-0 items-center justify-between border-t border-gray-100 bg-[#F8F9FA] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-700 dark:bg-slate-950/50">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-[#00634B] disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>
          <span className="text-xs font-semibold text-gray-500">
            Page {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-[#00634B] disabled:opacity-30"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <LawyerProfileSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        lawyer={selected}
        accessToken={accessToken}
        currentUserId={user?.uid}
        lawyerCaseId={lawyerCaseId}
        onConnectLegacy={async (lawyer) => {
          await onAccept(lawyer);
        }}
      />
    </div>
  );

  if (presentation === "embedded") {
    return panel;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Dismiss lawyer browser"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative z-10 w-full sm:w-auto sm:max-w-xl">{panel}</div>
    </div>
  );
}
