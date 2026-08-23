"use client";

import { Scale } from "lucide-react";
import type { FinalClashResult } from "@/lib/clashApi";

export function ClashVerdictPanel({ result }: { result: FinalClashResult }) {
  return (
    <div
      className="mx-4 mb-4 p-5 rounded-2xl border-2 border-[#00634B]/20 bg-gradient-to-br from-emerald-50 to-white"
      role="region"
      aria-label="Final verdict"
    >
      <div className="flex items-center gap-2 mb-3">
        <Scale className="text-[#00634B]" size={22} aria-hidden />
        <h3 className="font-bold text-[#00634B]">Mock Verdict</h3>
      </div>
      <p className="text-sm text-gray-800 mb-3">{result.mock_verdict}</p>
      {result.actionability_notes && (
        <div className="mb-3">
          <p className="text-xs font-bold text-gray-500 uppercase mb-1">
            Recommended next steps
          </p>
          <p className="text-sm text-gray-700">{result.actionability_notes}</p>
        </div>
      )}
      {result.evidence_gaps?.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-bold text-gray-500 uppercase mb-1">Evidence gaps</p>
          <ul className="text-sm text-gray-600 list-disc pl-4">
            {result.evidence_gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-gray-400 border-t border-gray-200 pt-3 mt-2">
        Simulation only — not legal advice. Consult a qualified advocate for real matters.
      </p>
    </div>
  );
}
