"use client";

import type { JudgeScore } from "@/lib/clashApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scale } from "lucide-react";

const WINNER_LABEL = {
  prosecution: "Prosecution",
  defence: "Defence",
  draw: "Draw",
};

export function ClashRoundScoreCard({ scores }: { scores: JudgeScore }) {
  const phaseLabel = (scores.phase || "round").replace(/_/g, " ");

  return (
    <div className="mb-4 flex w-full justify-center px-1">
      <Card className="w-full max-w-lg border-muted-foreground/15">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5 capitalize">
              <Scale className="size-4 text-primary" aria-hidden />
              Bench — {phaseLabel}
            </span>
            {scores.round_winner && (
              <Badge variant="secondary" className="capitalize">
                Phase: {WINNER_LABEL[scores.round_winner]}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="flex justify-center gap-6 text-center">
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Prosecution</p>
              <p className="text-lg font-bold text-primary">
                {(scores.prosecution_average ?? 0).toFixed(1)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Defence</p>
              <p className="text-lg font-bold text-amber-700">
                {(scores.defence_average ?? 0).toFixed(1)}
              </p>
            </div>
          </div>

          {(scores.parameters || []).map((p) => (
            <div
              key={p.parameter_id}
              className="rounded-md border bg-muted/30 px-2.5 py-2"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium">{p.parameter_label}</span>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {WINNER_LABEL[p.winner]}
                </Badge>
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span>P: {p.prosecution_score}</span>
                <span>D: {p.defence_score}</span>
              </div>
              {p.rationale && (
                <p className="mt-1 text-[10px] italic text-muted-foreground">
                  {p.rationale}
                </p>
              )}
            </div>
          ))}

          {scores.bench_note && (
            <p className="text-[11px] text-muted-foreground italic">{scores.bench_note}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
