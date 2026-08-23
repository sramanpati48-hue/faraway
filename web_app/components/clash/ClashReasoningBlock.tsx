"use client";

import { cn } from "@/lib/utils";
import type { AgentSide } from "@/lib/clashApi";
import { Badge } from "@/components/ui/badge";
import { Lightbulb } from "lucide-react";

export function ClashReasoningBlock({
  side,
  phase,
  content,
  lawSections,
  stepIndex,
}: {
  side: AgentSide;
  phase?: string;
  content: string;
  lawSections?: string[];
  stepIndex?: number;
}) {
  const isRight = side === "prosecution";

  return (
    <div
      className={cn(
        "mb-2 flex w-full",
        isRight ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[88%] rounded-lg border px-3 py-2 text-xs sm:max-w-[78%]",
          isRight
            ? "border-emerald-200/80 bg-emerald-50/90 text-emerald-950"
            : "border-amber-200/80 bg-amber-50/90 text-amber-950"
        )}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <Lightbulb className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="font-semibold uppercase tracking-wide opacity-80">
            {isRight ? "Prosecution (Complainant)" : "Defence (Accused)"} reasoning
            {stepIndex !== undefined ? ` · step ${stepIndex + 1}` : ""}
          </span>
          {phase && (
            <span className="rounded-full bg-background/60 px-1.5 py-0.5 text-[10px] capitalize">
              {phase.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <p className="leading-relaxed whitespace-pre-wrap">{content}</p>
        {lawSections && lawSections.length > 0 && (
          <div className="mt-2 flex min-w-0 flex-col gap-1">
            {lawSections.map((s) => (
              <Badge
                key={s}
                variant="outline"
                className="h-auto max-w-full min-w-0 shrink whitespace-normal break-words rounded-md px-2 py-1 text-left text-[10px] leading-snug font-normal"
              >
                {s}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
