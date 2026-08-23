"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useInView } from "framer-motion";
import { Mic, Send } from "lucide-react";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { cn } from "@/lib/utils";

const USER_PROBLEM = "Someone took money from my UPI after a fake bank call…";

const STEP_LABELS = ["Describe", "Register", "Route", "Advise"] as const;

/** Time each chat beat holds before the next — matches a calm reply cadence. */
const BEAT_MS = 2000;
const HOLD_LAST_MS = 3200;

/**
 * Synthetic product chrome for the marketing hero.
 * A 2s chat loop (composer → send → typing → AI reply) on every viewport.
 */
export function ProductPreview({ reduceMotion = false }: { reduceMotion?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.4 });
  const [step, setStep] = useState(reduceMotion ? 4 : 0);

  useEffect(() => {
    if (reduceMotion) {
      setStep(4);
      return;
    }
    if (!inView) {
      setStep(0);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    const play = async () => {
      while (!cancelled) {
        for (let next = 0; next <= 4; next += 1) {
          if (cancelled) return;
          setStep(next);
          await wait(next === 4 ? HOLD_LAST_MS : BEAT_MS);
        }
      }
    };

    void play();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inView, reduceMotion]);

  const labelIndex = Math.min(STEP_LABELS.length - 1, Math.max(0, step - 1));

  return (
    <div ref={rootRef} className="relative mx-auto w-full max-w-lg min-h-[31rem] sm:min-h-[33rem] lg:max-w-none lg:min-h-[34rem]">
      <div className="px-2 py-3 sm:px-4 lg:px-6 lg:py-6 [perspective:1400px]">
        <div
          className={cn(
            "origin-center transform-3d",
            "max-lg:[transform:rotateX(5deg)_rotateY(-6deg)_rotateZ(1deg)]",
            "lg:[transform:rotateX(12deg)_rotateY(-18deg)_rotateZ(4deg)]",
            "motion-reduce:[transform:none]"
          )}
        >
          <div className="relative rounded-xl border border-slate-200/80 bg-white p-1 shadow-[0_28px_50px_-28px_rgba(0,99,75,0.22),0_10px_28px_-16px_rgba(15,23,42,0.12)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
              <div className="flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
              </div>
              <span className={cn(dmSans.className, "ml-2 truncate text-[11px] font-medium text-slate-400")}>
                app.nyaysahayak.in/cases
              </span>
              <span className="ml-auto rounded-md bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                Preview
              </span>
            </div>

            <div className={cn(dmSans.className, "p-4 sm:p-5")}>
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
                  <Image src="/2.png" alt="" width={24} height={24} className="object-contain" />
                </div>
                <p className={cn(instrumentSerif.className, "text-lg text-slate-900 sm:text-xl")}>
                  You deserve to be heard
                </p>
                <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500">
                  Share what happened. We route you to the right path under Indian law.
                </p>
              </div>

              <div className="mt-3.5 flex h-[13.5rem] flex-col justify-end gap-2.5 overflow-hidden sm:h-[14.5rem]">
                {step >= 2 ? (
                  <div className="preview-chat-user ml-auto max-w-[90%] rounded-lg rounded-br-sm bg-[#00634B] px-3 py-2 text-left">
                    <p className="text-[11px] leading-relaxed text-white">{USER_PROBLEM}</p>
                  </div>
                ) : null}

                {step === 3 ? (
                  <p className="preview-chat-ai inline-flex w-fit items-center gap-2 rounded-lg rounded-bl-sm border border-slate-200/80 bg-white px-3 py-2 text-[10px] font-medium text-slate-500">
                    <TypingDots />
                    Reading your case…
                  </p>
                ) : null}

                {step >= 4 ? (
                  <div className="preview-chat-ai max-w-[95%] space-y-2 rounded-lg rounded-bl-sm border border-slate-200/80 bg-[#F8F9FA]/80 px-3 py-2.5 text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#00634B]">
                      Routed · Cyber specialist
                    </p>
                    <p className="text-[11px] leading-relaxed text-slate-600">
                      This looks like online fraud. Report on cybercrime.gov.in, dial 1930, and keep SMS/UPI
                      screenshots. Want a Zero FIR checklist next?
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        Evidence checklist
                      </span>
                      <span className="rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-medium text-[#00634B]">
                        Connect Nyay Guide
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-3.5 rounded-lg border border-emerald-100 bg-white p-2.5 shadow-sm ring-1 ring-emerald-500/10">
                <div className="flex items-center gap-2">
                  <div className="min-h-[36px] flex-1 rounded-md bg-slate-50/80 px-2.5 py-2 text-left text-[11px]">
                    {step === 1 ? (
                      <span className="preview-chat-user text-slate-800">
                        {USER_PROBLEM}
                        <span
                          className="ml-0.5 inline-block h-3 w-px translate-y-0.5 bg-[#00634B] motion-safe:animate-pulse"
                          aria-hidden
                        />
                      </span>
                    ) : (
                      <span className="text-slate-400">Describe your legal issue…</span>
                    )}
                  </div>
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500"
                    aria-hidden
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </span>
                  <span
                    className={cn(
                      "inline-flex h-8 items-center gap-1 rounded-md bg-[#00634B] px-2.5 text-[10px] font-semibold text-white transition-colors duration-200",
                      step === 1 && "bg-[#014D3C]"
                    )}
                  >
                    <Send className="h-3 w-3" />
                    Send
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p
        className={cn(
          dmSans.className,
          "mt-1 min-h-4 text-center text-[11px] text-slate-400",
          reduceMotion && "sr-only"
        )}
        aria-live="polite"
      >
        {step >= 4 ? "Case routed · Cyber specialist" : `Watch a case open · ${STEP_LABELS[labelIndex]}`}
      </p>
      <ol className="mx-auto mt-2 flex justify-center gap-1.5" aria-hidden>
        {STEP_LABELS.map((name, i) => {
          const filled = step > 0 && i <= labelIndex;
          return (
            <li
              key={name}
              className={cn(
                "h-1 w-6 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                filled ? "bg-[#00634B]" : "bg-slate-200"
              )}
            />
          );
        })}
      </ol>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="preview-typing-dot h-1 w-1 rounded-full bg-[#00634B]"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
