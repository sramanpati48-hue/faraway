"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import {
  FolderOpen,
  Calendar,
  ArrowUpRight,
  Scale,
  FileDown,
  Briefcase,
} from "lucide-react";
import { useGlobalChat, type SessionRecord } from "@/context/ChatContext";
import {
  EASE_OUT,
  MotionListItem,
  OperateEmptyState,
  OperateHeader,
  OperateLayout,
  OperateSkeletonGrid,
  staggerChildren,
} from "@/components/operate/OperatePrimitives";
import { instrumentSerif } from "@/lib/fonts";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface UserCase {
  case_id: string;
  session_id?: string;
  pdf_url?: string | null;
  structured_report: Record<string, unknown> & {
    summary?: string;
    incident_summary?: string;
    applicable_laws?: { section?: string }[];
    risk_level?: string;
  };
  session: SessionRecord[] | string | null;
  timestamp: unknown;
}

function normalizeTranscript(raw: unknown): SessionRecord[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m) =>
      m &&
      typeof m === "object" &&
      (m as SessionRecord).role !== "session_ui" &&
      Boolean(String((m as SessionRecord).content || "").trim())
  ) as SessionRecord[];
}

export default function MyCasesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [cases, setCases] = useState<UserCase[]>([]);
  const [loading, setLoading] = useState(true);
  const { openCaseThread, historyCache, sessionCache } = useGlobalChat();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!user) return;

    const fetchCases = async () => {
      try {
        const res = await fetch(`${API_URL}/api/cases?uid=${user.uid}`);
        if (res.ok) {
          const data = await res.json();
          setCases((data.cases || []) as UserCase[]);
        }
      } catch (err) {
        console.error("Failed to fetch cases", err);
      } finally {
        setLoading(false);
      }
    };

    fetchCases();
  }, [user]);

  const handleOpenCase = async (c: UserCase) => {
    const sid = String(c.session_id || c.case_id || "").trim();
    if (!sid) return;

    let hist = normalizeTranscript(c.session);

    // Prefer already-cached chat transcript for this id
    if (!hist.length) {
      const fromHistory = historyCache[sid];
      const fromSession = sessionCache.find((s) => s.id === sid)?.session_data;
      hist = normalizeTranscript(fromHistory?.length ? fromHistory : fromSession);
    }

    // Fall back to chat history API when formalised case.session is empty
    if (!hist.length && user?.uid) {
      try {
        const res = await fetch(
          `${API_URL}/api/chat/history?uid=${encodeURIComponent(user.uid)}&session_id=${encodeURIComponent(sid)}`
        );
        if (res.ok) {
          const data = await res.json();
          hist = normalizeTranscript(data.history);
        }
      } catch {
        /* ignore */
      }
    }

    openCaseThread(sid, hist);
    router.push(`/cases?session=${encodeURIComponent(sid)}`);
  };

  const formatDate = (ts: unknown) => {
    if (!ts) return "Recently";
    try {
      const d = new Date(ts as string | number | Date);
      if (isNaN(d.getTime())) return "Recently";
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return "Recently";
    }
  };

  if (loading) {
    return (
      <OperateLayout>
        <OperateHeader
          kicker="Case tracking"
          title="Formalised cases"
          description="Your structured legal consultations, saved securely."
        />
        <OperateSkeletonGrid count={4} />
      </OperateLayout>
    );
  }

  return (
    <OperateLayout>
      <OperateHeader
        kicker="Case tracking"
        title="Formalised cases"
        description="Review analysis, track evidence, or resume conversations with your AI assistant."
      />

      {cases.length === 0 ? (
        <OperateEmptyState
          icon={Scale}
          title="No cases yet"
          description="Request a legal analysis in chat to save your first formalised case."
        />
      ) : (
        <motion.ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
          variants={staggerChildren}
          initial={reduce ? false : "hidden"}
          animate="visible"
        >
          {cases.map((c, idx) => {
            const summary =
              c.structured_report?.summary ||
              c.structured_report?.incident_summary ||
              "Legal consultation case";
            const risk = c.structured_report?.risk_level;
            const laws = c.structured_report?.applicable_laws || [];

            return (
              <MotionListItem key={c.case_id || idx} index={idx}>
                <button
                  type="button"
                  onClick={() => void handleOpenCase(c)}
                  className="group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white p-5 text-left shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-out hover:border-emerald-200 hover:shadow-md active:scale-[0.99]"
                >
                  {risk === "High" ? (
                    <span className="absolute inset-x-0 top-0 h-0.5 bg-rose-500" aria-hidden />
                  ) : null}

                  <div className="mb-4 flex items-start justify-between gap-2">
                    <div className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-50 text-xs font-bold text-[#00634B]">
                      #{String(c.case_id || "").substring(0, 4) || "0000"}
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500">
                      <Calendar className="h-3 w-3" aria-hidden />
                      {formatDate(c.timestamp)}
                    </span>
                  </div>

                  <h3 className={cn(instrumentSerif.className, "mb-2 line-clamp-2 text-lg text-slate-900")}>
                    {summary}
                  </h3>

                  <div className="mb-4 flex-1 space-y-2">
                    {laws.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {laws.slice(0, 2).map((law, i) => (
                          <span
                            key={i}
                            className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                          >
                            {law.section}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {risk ? (
                      <span
                        className={cn(
                          "inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold",
                          risk === "High"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-800"
                        )}
                      >
                        Risk: {risk}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-700 transition-colors duration-200 group-hover:text-[#00634B]">
                    <span className="inline-flex items-center gap-1.5">
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                      Resume
                    </span>
                    <div className="flex items-center gap-2">
                      {(c.pdf_url || c.case_id) && (
                        <span
                          role="button"
                          tabIndex={0}
                          title={c.pdf_url ? "Download case PDF" : "Generate & download PDF"}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 transition-[transform,background-color] duration-150 ease-out hover:bg-emerald-100 active:scale-[0.97]"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (c.pdf_url) {
                              window.open(`${API_URL}/api/cases/${encodeURIComponent(c.case_id)}/pdf`, "_blank");
                              return;
                            }
                            void fetch(`${API_URL}/api/cases/${encodeURIComponent(c.case_id)}/generate-pdf`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                case_id: c.case_id,
                                user_id: user?.uid,
                                structured_report: c.structured_report,
                              }),
                            })
                              .then(async (res) => {
                                if (!res.ok) throw new Error("PDF generation failed");
                                const data = await res.json();
                                const url =
                                  data.pdf_url ||
                                  `${API_URL}/api/cases/${encodeURIComponent(c.case_id)}/pdf`;
                                window.open(url, "_blank");
                                setCases((prev) =>
                                  prev.map((x) =>
                                    x.case_id === c.case_id
                                      ? { ...x, pdf_url: data.pdf_url || x.pdf_url }
                                      : x
                                  )
                                );
                              })
                              .catch((err) => console.error(err));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                          }}
                        >
                          <FileDown className="h-3 w-3" aria-hidden />
                          PDF
                        </span>
                      )}
                      <ArrowUpRight className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </button>
              </MotionListItem>
            );
          })}
        </motion.ul>
      )}

      {cases.length > 0 ? (
        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.35, ease: EASE_OUT }}
          className="mt-6 flex items-center gap-2 text-xs text-slate-400"
        >
          <Briefcase className="h-3.5 w-3.5" aria-hidden />
          {cases.length} saved {cases.length === 1 ? "case" : "cases"}
        </motion.p>
      ) : null}
    </OperateLayout>
  );
}
