"use client";

import type { FinalClashResult, JudgeScore } from "@/lib/clashApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gavel, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClashVerdictPieChart } from "./ClashVerdictPieChart";

const WINNER_LABELS: Record<string, string> = {
  prosecution: "Prosecution / Complainant",
  defence: "Defence",
  draw: "Draw",
};

export function ClashJudgmentCard({
  result,
  streaming,
  partialContent,
}: {
  result?: FinalClashResult;
  streaming?: boolean;
  partialContent?: string;
}) {
  const display = partialContent || result?.winner_explanation || "";
  const winner = result?.declared_winner;
  const roundScores: JudgeScore[] = (result?.round_scores || []) as JudgeScore[];

  return (
    <div className="mb-4 flex w-full justify-center px-1">
      <Card
        className={cn(
          "w-full max-w-2xl border-2",
          winner === "prosecution"
            ? "border-primary/40 bg-primary/5"
            : winner === "defence"
              ? "border-amber-300/50 bg-amber-50/50"
              : "border-muted"
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-primary">
            <Gavel className="size-5" aria-hidden />
            Final judgment
            {streaming && (
              <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
            )}
            {winner && !streaming && (
              <Badge className="ml-auto capitalize">
                Winner: {WINNER_LABELS[winner]}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {display && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Why this side prevailed
              </p>
              <p className="leading-relaxed whitespace-pre-wrap text-foreground">
                {display}
              </p>
            </div>
          )}

          {result && (
            <>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-start">
                <div className="flex flex-wrap gap-4 rounded-lg bg-muted/40 p-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Prosecution avg </span>
                    <span className="font-bold text-primary">
                      {(result.prosecution_overall_average ?? 0).toFixed(1)}/20
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Defence avg </span>
                    <span className="font-bold text-amber-700">
                      {(result.defence_overall_average ?? 0).toFixed(1)}/20
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Confidence </span>
                    <span className="font-medium capitalize">{result.confidence_band}</span>
                  </div>
                </div>
                {roundScores.length > 0 && (
                  <ClashVerdictPieChart
                    finalResult={result}
                    roundScores={roundScores}
                    tone="light"
                  />
                )}
              </div>

              {(result.parameter_totals || []).length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                    <Scale className="size-3.5" aria-hidden />
                    Parameter record
                  </p>
                  <ul className="space-y-2">
                    {result.parameter_totals!.map((p) => (
                      <li
                        key={p.parameter_id}
                        className="rounded-md border bg-background px-2.5 py-2 text-xs"
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{p.parameter_label}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {WINNER_LABELS[p.winner] || p.winner}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          P {p.prosecution_score} vs D {p.defence_score}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.mock_verdict && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Mock legal outcome
                  </p>
                  <p className="text-sm">{result.mock_verdict}</p>
                </div>
              )}

              {result.actionability_notes && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Next steps
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {result.actionability_notes}
                  </p>
                </div>
              )}

              <p className="border-t pt-2 text-[10px] text-muted-foreground">
                Simulation only — not legal advice.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
