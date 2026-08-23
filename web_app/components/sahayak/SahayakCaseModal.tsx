"use client";

import {
  Calendar, CheckCircle2, ExternalLink, FileDown, HeartHandshake, Loader2,
  MapPin, MessageCircle, Phone, Scale, User, X, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SahayakCaseModalData = {
  id: string;
  user_name: string;
  structured_report?: {
    incident_type?: string;
    risk_level?: string;
    summary?: string;
    statutory_sections?: string[];
    checklist?: string[];
    location?: string | { city?: string; state?: string };
    contact?: string;
  };
  location?: { city?: string; state?: string; lat?: number; lon?: number };
  status: "pending" | "accepted";
  assigned_sahayak_id?: string;
  created_at: string;
};

const RISK_COLORS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700 border-red-200",
  MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
  LOW: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function formatField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => formatField(v)).join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    if (obj.city) parts.push(String(obj.city));
    if (obj.state) parts.push(String(obj.state));
    if (parts.length) return parts.join(", ");
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }
  return String(value);
}

type Props = {
  caseItem: SahayakCaseModalData;
  currentUserId?: string;
  accepting?: boolean;
  declining?: boolean;
  chatLoading?: boolean;
  onClose: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onDownloadPdf: () => void;
  onOpenChat?: () => void;
};

export function SahayakCaseModal({
  caseItem,
  currentUserId,
  accepting,
  declining,
  chatLoading,
  onClose,
  onAccept,
  onDecline,
  onDownloadPdf,
  onOpenChat,
}: Props) {
  const risk = (caseItem.structured_report?.risk_level || "MEDIUM").toUpperCase();
  const location =
    formatField(caseItem.location) || formatField(caseItem.structured_report?.location);
  const contact = formatField(caseItem.structured_report?.contact);
  const isPending = caseItem.status === "pending";
  const isMine =
    caseItem.status === "accepted" && caseItem.assigned_sahayak_id === currentUserId;
  const busy = accepting || declining;

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label="Close case details"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sahayak-case-modal-title"
        className={cn(
          "relative z-10 flex w-full flex-col bg-white shadow-2xl overflow-hidden",
          "max-h-[92dvh] sm:max-h-[88vh]",
          "rounded-t-3xl sm:rounded-3xl",
          "sm:max-w-2xl lg:max-w-3xl",
          "animate-in slide-in-from-bottom-4 sm:fade-in sm:zoom-in-95 duration-200"
        )}
      >
        <div className="relative shrink-0 bg-gradient-to-br from-[#0B3D2E] via-[#00634B] to-[#0A8F6C] px-5 sm:px-7 pt-5 pb-6 text-white">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 h-9 w-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center"
          >
            <X size={16} />
          </button>
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className={cn("text-[10px] font-black px-2.5 py-1 rounded-full border uppercase tracking-wide", RISK_COLORS[risk] || RISK_COLORS.MEDIUM)}>
              {risk} risk
            </span>
            <span className={cn(
              "text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wide",
              isPending ? "bg-amber-400/90 text-amber-950" : "bg-emerald-400/90 text-emerald-950"
            )}>
              {caseItem.status}
            </span>
          </div>
          <h2 id="sahayak-case-modal-title" className="mt-3 text-xl sm:text-2xl font-black leading-tight">
            {caseItem.structured_report?.incident_type || "Legal Case"}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-emerald-50/90">
            <span className="inline-flex items-center gap-1.5">
              <User size={14} /> {caseItem.user_name || "Anonymous"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={14} />
              {new Date(caseItem.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}
            </span>
            {location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} /> {location}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 space-y-5">
          <section>
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Case Summary
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed bg-[#F8F9FA] rounded-2xl border border-gray-100 p-4">
              {formatField(caseItem.structured_report?.summary) || "No summary available."}
            </p>
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-3 text-sm text-gray-700 bg-[#F8F9FA] rounded-2xl p-3.5 border border-gray-100">
              <User size={15} className="text-gray-400 shrink-0" />
              <span className="font-semibold">{caseItem.user_name || "Anonymous"}</span>
            </div>
            {contact && (
              <a
                href={`tel:${contact}`}
                className="flex items-center gap-3 text-sm text-[#00634B] bg-emerald-50 rounded-2xl p-3.5 border border-emerald-100 hover:bg-emerald-100 transition-colors"
              >
                <Phone size={15} className="shrink-0" />
                <span className="font-bold">{contact}</span>
              </a>
            )}
          </div>

          {(caseItem.structured_report?.statutory_sections?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                Applicable Laws
              </h3>
              <div className="flex flex-wrap gap-2">
                {caseItem.structured_report?.statutory_sections?.map((sec, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-2.5 py-1.5"
                  >
                    <Scale size={12} />
                    {sec}
                  </span>
                ))}
              </div>
            </section>
          )}

          {(caseItem.structured_report?.checklist?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                Action Checklist
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {caseItem.structured_report?.checklist?.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-xs text-gray-700 bg-[#F8F9FA] rounded-xl p-3 border border-gray-100"
                  >
                    <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <button
            type="button"
            onClick={onDownloadPdf}
            className="w-full flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 px-4 py-3.5 transition-colors text-left"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <FileDown size={12} /> Case report
              </p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5">Download generated PDF report</p>
            </div>
            <ExternalLink size={16} className="text-[#00634B] shrink-0" />
          </button>
        </div>

        <div className="shrink-0 border-t border-gray-100 bg-white px-5 sm:px-7 py-4 space-y-2">
          {isPending && (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onDecline}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-bold py-3.5 text-sm disabled:opacity-50"
              >
                {declining ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                Reject
              </button>
              <button
                type="button"
                onClick={onAccept}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3.5 text-sm disabled:opacity-50 shadow-lg shadow-[#00634B]/20"
              >
                {accepting ? <Loader2 size={16} className="animate-spin" /> : <HeartHandshake size={16} />}
                Accept
              </button>
            </div>
          )}
          {isMine && (
            <button
              type="button"
              onClick={onOpenChat}
              disabled={chatLoading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3.5 text-sm disabled:opacity-50"
            >
              {chatLoading ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
              Open Client Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
