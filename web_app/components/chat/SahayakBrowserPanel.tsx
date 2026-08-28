"use client";

import { useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, History } from "lucide-react";
import { SahayakListCard } from "@/components/sahayak/SahayakListCard";
import { SahayakProfileSheet } from "@/components/sahayak/SahayakProfileSheet";
import type { SahayakProfile } from "@/lib/sahayakTypes";
import { normalizeSahayakProfile, sahayakIdOf } from "@/lib/sahayakTypes";
import { useAuth } from "@/context/AuthContext";

export type { SahayakProfile };

const PAGE_SIZE = 5;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface SahayakBrowserPanelProps {
  sahayaks: SahayakProfile[];
  sahayakCaseId: string | null;
  userId: string;
  onAccept: (sahayakUid: string, sahayakName: string) => void;
  onClose: () => void;
  initialAcceptedId?: string | null;
}

export function SahayakBrowserPanel({
  sahayaks,
  sahayakCaseId,
  userId,
  onAccept,
  onClose,
  initialAcceptedId,
}: SahayakBrowserPanelProps) {
  const { user, accessToken } = useAuth();
  const normalized = useMemo(
    () => (sahayaks || []).map((s) => normalizeSahayakProfile(s as any)),
    [sahayaks]
  );

  const assigned = normalized.find((s) => s.isAssigned);
  const [page, setPage] = useState(0);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SahayakProfile | null>(assigned || null);
  const [sheetOpen, setSheetOpen] = useState(Boolean(assigned || initialAcceptedId));
  const [acceptedId, setAcceptedId] = useState<string | null>(
    initialAcceptedId || assigned?.uid || null
  );
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);

  const available = normalized.filter((s) => !rejected.has(sahayakIdOf(s)));
  const pageCount = Math.max(1, Math.ceil(available.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = available.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const isRestored = !!(assigned || initialAcceptedId);

  const openProfile = (sahayak: SahayakProfile) => {
    setSelected(sahayak);
    setSheetOpen(true);
  };

  const handleReject = (sahayak: SahayakProfile) => {
    const id = sahayakIdOf(sahayak);
    setRejected((prev) => new Set([...prev, id]));
    if (selected && sahayakIdOf(selected) === id) {
      setSheetOpen(false);
      setSelected(null);
    }
  };

  const acceptCase = async (sahayak: SahayakProfile) => {
    if (!sahayakCaseId) return;
    const res = await fetch(`${API_URL}/api/sahayak/cases/${sahayakCaseId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sahayak_id: sahayakIdOf(sahayak),
        sahayak_name: sahayak.name,
        sahayak_uid: sahayakIdOf(sahayak),
      }),
    });
    if (!res.ok) throw new Error("Failed to accept guide");
    setAcceptedId(sahayakIdOf(sahayak));
    onAccept(sahayakIdOf(sahayak), sahayak.name);
  };

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-slate-900 border-l border-gray-100 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-[#E6F0ED] to-white flex-shrink-0">
        <div>
          <h2 className="text-[15px] font-black text-[#00634B] tracking-tight">
            {isRestored ? "Your Nyay Guide" : "Nyay Guides near you"}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {isRestored
              ? "You are connected — open chat anytime"
              : `${available.length} guides matched to your area`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
        >
          <X size={16} />
        </button>
      </div>

      {isRestored && (
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-100 shrink-0">
          <History size={12} className="text-emerald-600" />
          <span className="text-[11px] font-bold text-emerald-700">
            Restored from your session history
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5">
        {pageItems.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-center px-4">
            <p className="text-sm text-gray-500">No more guides in this list.</p>
          </div>
        ) : (
          pageItems.map((sahayak) => (
            <div key={sahayakIdOf(sahayak)} className="space-y-1.5">
              <SahayakListCard
                sahayak={sahayak}
                selected={selected ? sahayakIdOf(selected) === sahayakIdOf(sahayak) : false}
                onClick={() => openProfile(sahayak)}
              />
              {!acceptedId && (
                <button
                  type="button"
                  onClick={() => handleReject(sahayak)}
                  className="w-full text-[11px] font-bold text-gray-400 hover:text-red-500 py-1"
                >
                  Not a good fit
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {available.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-[#F8F9FA] flex-shrink-0">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex items-center gap-1 text-xs font-bold text-[#00634B] disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <span className="text-xs font-semibold text-gray-500">
            Page {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="inline-flex items-center gap-1 text-xs font-bold text-[#00634B] disabled:opacity-30"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <SahayakProfileSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sahayak={selected}
        accessToken={accessToken}
        currentUserId={user?.uid || userId}
        sahayakCaseId={sahayakCaseId}
        initialMode={acceptedId && selected && sahayakIdOf(selected) === acceptedId ? "chat" : "profile"}
        initialThreadId={initialThreadId}
        onConnectLegacy={async (s) => {
          if (!acceptedId || acceptedId !== sahayakIdOf(s)) {
            await acceptCase(s);
          }
        }}
        onConnected={({ threadId }) => {
          setInitialThreadId(threadId);
          setAcceptedId(selected ? sahayakIdOf(selected) : acceptedId);
        }}
      />
    </div>
  );
}
