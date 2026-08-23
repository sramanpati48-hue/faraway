"use client";

import type { JudgeParameter } from "@/lib/clashApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gavel } from "lucide-react";

export function ClashParametersPanel({
  parameters,
}: {
  parameters: JudgeParameter[];
}) {
  return (
    <div className="mb-4 flex w-full justify-center">
      <Card className="w-full max-w-xl border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-primary">
            <Gavel className="size-4" aria-hidden />
            Bench evaluation parameters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {parameters.map((p) => (
              <li key={p.id}>
                <span className="font-medium text-foreground">{p.label}</span>
                {p.description ? ` — ${p.description}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Each phase, the bench scores Prosecution and Defence independently on every
            parameter. The side with the higher overall average wins.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
