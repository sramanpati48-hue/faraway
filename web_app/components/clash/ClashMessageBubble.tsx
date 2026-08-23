"use client";

import { cn } from "@/lib/utils";
import type { AgentSide } from "@/lib/clashApi";

const SIDE_LABELS: Record<string, string> = {
  prosecution: "Prosecution (Complainant)",
  defence: "Defence (Accused)",
};

export function ClashMessageBubble({
  side,
  phase,
  content,
  streaming,
}: {
  side: AgentSide;
  phase?: string;
  content: string;
  streaming?: boolean;
}) {
  const isRight = side === "prosecution";

  return (
    <div
      className={cn(
        "flex w-full mb-3",
        isRight ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[88%] sm:max-w-[75%] rounded-xl px-3 py-2.5 shadow-sm border",
          isRight
            ? "bg-[#00634B] text-white border-[#014D3C] rounded-br-md"
            : "bg-white text-gray-800 border-gray-200 rounded-bl-md"
        )}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              isRight ? "text-emerald-100" : "text-[#00634B]"
            )}
          >
            {SIDE_LABELS[side] || side}
          </span>
          {phase && (
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full",
                isRight ? "bg-white/15" : "bg-emerald-50 text-[#00634B]"
              )}
            >
              {phase.replace(/_/g, " ")}
            </span>
          )}
          {streaming && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse opacity-70" />
          )}
        </div>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}
