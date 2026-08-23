"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Gavel, Scale, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FinalClashResult, JudgeScore } from "@/lib/clashApi";
import { MAX_CLASH_ROUNDS } from "@/lib/clashVerdictWeights";
import { ClashVerdictPieChart } from "./ClashVerdictPieChart";

function formatScore(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
  return String(Math.round(Number(n)));
}

const WINNER_LABELS: Record<string, string> = {
  prosecution: "Prosecution / Complainant",
  defence: "Defence",
  draw: "Draw — neither side clearly prevailed",
};

function BenchContent({
  roundScores,
  finalResult,
  mode,
  isStreaming,
  panelId,
}: {
  roundScores: JudgeScore[];
  finalResult: FinalClashResult | null;
  mode: "practice" | "real_life";
  isStreaming?: boolean;
  panelId?: string;
}) {
  return (
    <div
      id={panelId}
      className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3 text-[11px] custom-scrollbar-emerald"
    >
      <div className="flex items-center gap-1.5 text-[#00634B] font-bold uppercase tracking-wide">
        <Gavel size={14} aria-hidden />
        <span>Bench</span>
        {isStreaming && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#00634B] animate-pulse" />
        )}
      </div>

      {roundScores.length === 0 && !finalResult && (
        <p className="text-[10px] text-gray-400 leading-snug">
          Round scores appear after each exchange.
        </p>
      )}

      {roundScores.slice(0, MAX_CLASH_ROUNDS).map((r, i) => (
        <div
          key={`${r.phase}-${i}`}
          className="rounded-lg border border-gray-100 bg-gray-50/80 p-2.5"
        >
          <div className="font-semibold text-gray-600 capitalize text-[10px] mb-0.5">
            {(r.phase || `Round ${i + 1}`).replace(/_/g, " ")}
          </div>
          <div className="text-lg font-black text-[#00634B] leading-none">
            {formatScore(r.round_total)}
            <span className="text-[9px] font-normal text-gray-400">/100</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1.5 text-[9px] text-gray-500">
            <span>Legal: {formatScore(r.legal_accuracy)}</span>
            <span>Coherence: {formatScore(r.coherence)}</span>
            <span>Evidence: {formatScore(r.evidence_usage)}</span>
            <span>Procedure: {formatScore(r.procedural_soundness)}</span>
          </div>
          {r.bench_note && (
            <p className="text-[9px] text-gray-500 italic mt-1 leading-snug">
              {r.bench_note}
            </p>
          )}
        </div>
      ))}

      {finalResult && (
        <div className="rounded-xl bg-[#00634B] text-white p-3 space-y-2">
          <ClashVerdictPieChart
            finalResult={finalResult}
            roundScores={roundScores}
          />

          <div
            className={cn(
              "rounded-lg p-2.5 border",
              finalResult.declared_winner === "prosecution"
                ? "bg-emerald-400/20 border-emerald-300/40"
                : finalResult.declared_winner === "defence"
                  ? "bg-amber-400/20 border-amber-300/40"
                  : "bg-white/10 border-white/20"
            )}
          >
            <p className="text-[9px] font-bold uppercase tracking-wider opacity-90 mb-1">
              Declared winner
            </p>
            <p className="text-sm font-black leading-tight">
              {WINNER_LABELS[finalResult.declared_winner] || finalResult.declared_winner}
            </p>
            {finalResult.winner_explanation && (
              <p className="text-[10px] leading-snug mt-1.5 opacity-95">
                {finalResult.winner_explanation}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase opacity-90">
            <Scale size={12} aria-hidden />
            {mode === "real_life" ? "Case strength" : "Bench score"}
          </div>
          <div className="text-2xl font-black leading-none">
            {formatScore(finalResult.overall_score)}
            <span className="text-[10px] font-normal opacity-80">/100</span>
          </div>
          <p className="text-[10px] opacity-90">
            Confidence: {finalResult.confidence_band}
          </p>
          <div className="border-t border-white/20 pt-2">
            <p className="text-[10px] font-bold uppercase opacity-80 mb-1">
              Mock legal outcome
            </p>
            <p className="text-[11px] leading-snug">{finalResult.mock_verdict}</p>
          </div>
          {finalResult.actionability_notes && (
            <div>
              <p className="text-[10px] font-bold uppercase opacity-80 mb-0.5">
                Next steps
              </p>
              <p className="text-[10px] leading-snug opacity-95">
                {finalResult.actionability_notes}
              </p>
            </div>
          )}
          {finalResult.evidence_gaps?.length > 0 && (
            <ul className="text-[9px] list-disc pl-3 opacity-90 space-y-0.5">
              {finalResult.evidence_gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
          <p className="text-[8px] opacity-60 pt-1 border-t border-white/10">
            Simulation only — not legal advice.
          </p>
        </div>
      )}
    </div>
  );
}

export function ClashBenchSidebar({
  roundScores,
  finalResult,
  mode,
  isStreaming,
}: {
  roundScores: JudgeScore[];
  finalResult: FinalClashResult | null;
  mode: "practice" | "real_life";
  isStreaming?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const contentProps = { roundScores, finalResult, mode, isStreaming };

  return (
    <>
      {/* Mobile: floating toggle + drawer */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-[#00634B] text-white px-4 py-2.5 text-xs font-bold shadow-lg shadow-emerald-900/30"
        aria-controls="clash-bench-panel-mobile"
      >
        <Gavel size={14} aria-hidden />
        Bench
        {(roundScores.length > 0 || finalResult) && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
        )}
      </button>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div
            className="relative flex h-full w-[min(20rem,90vw)] flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-300"
            aria-label="Bench panel"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#00634B]">
                Bench
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close bench panel"
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-[#00634B]"
              >
                <X size={16} />
              </button>
            </div>
            <BenchContent {...contentProps} panelId="clash-bench-panel-mobile" />
          </div>
        </div>
      )}

      {/* Desktop: side panel */}
      <div
        className={cn(
          "hidden md:flex h-full min-h-0 shrink-0 flex-col border-l border-gray-200 bg-white transition-all duration-300",
          open ? "w-64 lg:w-72" : "w-10"
        )}
        aria-label="Bench panel"
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-center gap-1 w-full py-2 border-b border-gray-100 text-[#00634B] hover:bg-emerald-50/50 text-[10px] font-bold uppercase tracking-wider"
          aria-expanded={open}
          aria-controls="clash-bench-panel"
        >
          {open ? (
            <>
              <ChevronRight size={14} aria-hidden />
              <span>Hide bench</span>
            </>
          ) : (
            <ChevronLeft size={16} aria-hidden />
          )}
        </button>

        {open && <BenchContent {...contentProps} panelId="clash-bench-panel" />}
      </div>
    </>
  );
}
