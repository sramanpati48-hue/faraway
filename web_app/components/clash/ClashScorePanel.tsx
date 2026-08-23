"use client";

import { Gavel } from "lucide-react";
import type { FinalClashResult, JudgeScore } from "@/lib/clashApi";

export function ClashScorePanel({
  roundScores,
  finalResult,
  mode,
}: {
  roundScores: JudgeScore[];
  finalResult: FinalClashResult | null;
  mode: "practice" | "real_life";
}) {
  return (
    <aside
      className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-gray-100 bg-gray-50/80 p-4 overflow-y-auto max-h-[40vh] lg:max-h-full"
      aria-label="Judge scores"
    >
      <h3 className="flex items-center gap-2 text-sm font-bold text-[#00634B] mb-3">
        <Gavel size={18} aria-hidden />
        Bench Scores
      </h3>

      {roundScores.length === 0 && !finalResult && (
        <p className="text-xs text-gray-500">Scores appear after each round.</p>
      )}

      <div className="space-y-3">
        {roundScores.map((r, i) => (
          <div
            key={`${r.phase}-${i}`}
            className="bg-white rounded-xl p-3 border border-gray-100 text-xs"
          >
            <div className="font-bold text-gray-700 mb-1 capitalize">
              {(r.phase || `Round ${i + 1}`).replace(/_/g, " ")}
            </div>
            <div className="text-2xl font-black text-[#00634B] mb-1">
              {Math.round(r.round_total)}
              <span className="text-xs font-normal text-gray-400">/100</span>
            </div>
            {r.bench_note && (
              <p className="text-gray-500 italic">{r.bench_note}</p>
            )}
          </div>
        ))}
      </div>

      {finalResult && (
        <div className="mt-4 p-4 rounded-2xl bg-[#00634B] text-white">
          <div className="text-[10px] uppercase tracking-wider opacity-80 mb-1">
            {mode === "real_life" ? "Case strength" : "Final evaluation"}
          </div>
          <div className="text-3xl font-black">{Math.round(finalResult.overall_score)}</div>
          <div className="text-xs mt-1 opacity-90">
            Confidence: {finalResult.confidence_band}
          </div>
        </div>
      )}
    </aside>
  );
}
