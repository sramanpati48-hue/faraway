import type { FinalClashResult, JudgeScore } from "@/lib/clashApi";

export const MAX_CLASH_ROUNDS = 3;

export interface JudgmentWeights {
  prosecution: number;
  defence: number;
  prosecutionPct: number;
  defencePct: number;
}

/** Bench weight of Prosecution vs Defence (from parameter averages, max 3 rounds). */
export function computeJudgmentWeights(
  finalResult: FinalClashResult,
  roundScores: JudgeScore[]
): JudgmentWeights {
  let prosecution = Number(finalResult.prosecution_overall_average) || 0;
  let defence = Number(finalResult.defence_overall_average) || 0;

  if (prosecution <= 0 && defence <= 0 && finalResult.parameter_totals?.length) {
    for (const p of finalResult.parameter_totals) {
      prosecution += Number(p.prosecution_score) || 0;
      defence += Number(p.defence_score) || 0;
    }
  }

  if (prosecution <= 0 && defence <= 0) {
    const rounds = roundScores.slice(0, MAX_CLASH_ROUNDS);
    for (const r of rounds) {
      prosecution += Number(r.prosecution_average) || 0;
      defence += Number(r.defence_average) || 0;
      if (r.parameters?.length) {
        for (const p of r.parameters) {
          prosecution += Number(p.prosecution_score) || 0;
          defence += Number(p.defence_score) || 0;
        }
      }
    }
  }

  const total = prosecution + defence;
  if (total <= 0) {
    return { prosecution: 0, defence: 0, prosecutionPct: 50, defencePct: 50 };
  }

  const prosecutionPct = Math.round((prosecution / total) * 100);
  return {
    prosecution,
    defence,
    prosecutionPct,
    defencePct: 100 - prosecutionPct,
  };
}
