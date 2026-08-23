"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, Lightbulb, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentSide, RagCitation } from "@/lib/clashApi";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export type ActivityReasoningStep = {
  id: string;
  content: string;
  lawSections?: string[];
  stepIndex?: number;
};

export type ActivityRag = {
  id: string;
  citations: RagCitation[];
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useTypewriter(text: string, active: boolean, reducedMotion: boolean): string {
  const [shown, setShown] = useState(reducedMotion || !active ? text : "");

  useEffect(() => {
    if (!active || reducedMotion) {
      setShown(text);
      return;
    }
    setShown("");
    const words = text.split(/(\s+)/);
    let i = 0;
    let raf = 0;
    let last = performance.now();
    const intervalMs = 22;

    const tick = (now: number) => {
      if (now - last >= intervalMs) {
        last = now;
        i += 1;
        setShown(words.slice(0, i).join(""));
      }
      if (i < words.length) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, active, reducedMotion]);

  return shown;
}

function TypewriterLine({
  text,
  active,
  reducedMotion,
  className,
}: {
  text: string;
  active: boolean;
  reducedMotion: boolean;
  className?: string;
}) {
  const shown = useTypewriter(text, active, reducedMotion);
  return (
    <p className={cn("leading-relaxed whitespace-pre-wrap", className)}>
      {shown}
      {active && shown.length < text.length && !reducedMotion ? (
        <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current align-middle opacity-60" />
      ) : null}
    </p>
  );
}

function firstLine(content: string): string {
  const line = (content || "").split(/\n/)[0]?.trim() || "";
  if (line.length <= 96) return line;
  return `${line.slice(0, 93)}…`;
}

function citationLabel(c: RagCitation): string {
  return (
    c.label ||
    [c.act_name, c.section_number && `s.${c.section_number}`, c.title]
      .filter(Boolean)
      .join(" — ") ||
    "Authority"
  );
}

export function ClashActivityBlock({
  side,
  phase,
  rag,
  reasoning,
  live,
  argumentStarted,
}: {
  side: AgentSide;
  phase?: string;
  rag?: ActivityRag | null;
  reasoning: ActivityReasoningStep[];
  /** True while this turn's activity is still streaming (no argument yet). */
  live: boolean;
  /** True once the argument bubble for this side has started. */
  argumentStarted: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const isRight = side === "prosecution";
  const sourceCount = rag?.citations.length ?? 0;
  const stepCount = reasoning.length;
  const phaseLabel = phase ? phase.replace(/_/g, " ") : "this turn";

  // Auto-open while live and no argument yet; auto-collapse when argument starts.
  // User can still toggle afterward.
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const autoOpen = live && !argumentStarted;
  const open = userOverride ?? autoOpen;

  useEffect(() => {
    // Reset override when a new live turn begins so auto-open works again
    if (live && !argumentStarted) {
      setUserOverride(null);
    }
  }, [live, argumentStarted]);

  // Which reasoning step is the "active" revealing one
  const activeStepIndex = useMemo(() => {
    if (!live || argumentStarted || reducedMotion) return -1;
    return stepCount > 0 ? stepCount - 1 : -1;
  }, [live, argumentStarted, reducedMotion, stepCount]);

  const summary = `Thought for the ${phaseLabel} · ${stepCount} step${
    stepCount === 1 ? "" : "s"
  }${sourceCount > 0 ? ` · ${sourceCount} source${sourceCount === 1 ? "" : "s"}` : ""}`;

  const sideLabel =
    side === "prosecution"
      ? "Prosecution"
      : side === "defence"
        ? "Defence"
        : "Counsel";

  return (
    <div className={cn("mb-2 flex w-full", isRight ? "justify-end" : "justify-start")}>
      <Collapsible
        open={open}
        onOpenChange={(next) => setUserOverride(next)}
        className={cn(
          "w-full max-w-[92%] rounded-xl border sm:max-w-[78%]",
          isRight
            ? "border-emerald-200/80 bg-emerald-50/70"
            : "border-amber-200/80 bg-amber-50/70"
        )}
      >
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
            isRight ? "text-emerald-950 hover:bg-emerald-100/50" : "text-amber-950 hover:bg-amber-100/50"
          )}
        >
          {live && !argumentStarted ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin opacity-70" aria-hidden />
          ) : (
            <Lightbulb className="size-3.5 shrink-0 opacity-70" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">
            <span className="font-semibold">{sideLabel}</span>
            <span className="opacity-70"> · {summary}</span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 opacity-60 transition-transform duration-200",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </CollapsibleTrigger>

        <CollapsibleContent keepMounted>
          <div className="space-y-2 border-t border-black/5 px-3 py-2.5">
            {rag && (
              <div className="rounded-lg border border-emerald-200/60 bg-white/60 px-2.5 py-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                  <BookOpen className="size-3.5 shrink-0" aria-hidden />
                  {sourceCount > 0
                    ? "Indian law on record"
                    : live
                      ? "Retrieving Indian law…"
                      : "Indian law on record"}
                </div>
                {sourceCount > 0 ? (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    {rag.citations.map((c, i) => (
                      <Badge
                        key={`${c.id ?? c.label ?? i}`}
                        variant="secondary"
                        className="h-auto max-w-full min-w-0 shrink whitespace-normal break-words rounded-lg bg-white/80 px-2.5 py-1.5 text-left text-[10px] leading-snug font-normal"
                      >
                        {citationLabel(c)}
                      </Badge>
                    ))}
                  </div>
                ) : live ? (
                  <p className="text-[11px] text-muted-foreground">Searching legal_documents…</p>
                ) : null}
              </div>
            )}

            {reasoning.map((step, idx) => {
              const isActive = idx === activeStepIndex;
              const collapsedLine = !isActive && (idx < activeStepIndex || !live || argumentStarted);
              // While live: older steps collapse to one line; active step typewrites
              const showCollapsed =
                live && !argumentStarted && !reducedMotion
                  ? idx < activeStepIndex
                  : false;

              if (showCollapsed) {
                return (
                  <div
                    key={step.id}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-[11px]",
                      isRight
                        ? "border-emerald-100 bg-white/50 text-emerald-900/80"
                        : "border-amber-100 bg-white/50 text-amber-900/80"
                    )}
                  >
                    <span className="mr-1.5 font-semibold opacity-60">
                      Step {(step.stepIndex ?? idx) + 1}
                    </span>
                    <span className="opacity-80">{firstLine(step.content)}</span>
                  </div>
                );
              }

              return (
                <div
                  key={step.id}
                  className={cn(
                    "rounded-md border px-2.5 py-2 text-xs",
                    isRight
                      ? "border-emerald-100 bg-white/70 text-emerald-950"
                      : "border-amber-100 bg-white/70 text-amber-950"
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                    <Lightbulb className="size-3 opacity-70" aria-hidden />
                    Reasoning · step {(step.stepIndex ?? idx) + 1}
                  </div>
                  <TypewriterLine
                    text={step.content}
                    active={isActive}
                    reducedMotion={reducedMotion || Boolean(collapsedLine && !isActive)}
                  />
                  {step.lawSections && step.lawSections.length > 0 && (
                    <div className="mt-2 flex min-w-0 flex-col gap-1">
                      {step.lawSections.map((s) => (
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
              );
            })}

            {!rag && reasoning.length === 0 && live && (
              <p className="text-[11px] text-muted-foreground">Thinking…</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
