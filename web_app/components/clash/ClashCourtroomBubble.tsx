"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { DebateTurn } from "@/lib/clash/debateTurns";
import { speakerColumn, speakerLabel, turnBadgeLabel } from "@/lib/clash/debateTurns";
import type { UserRole } from "@/lib/clashApi";
import { EASE_OUT } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";

const MAX_VISIBLE_PER_SIDE = 1;

export const clashBubbleExit = {
  opacity: 0,
  scale: 0.35,
  x: 140,
  y: -220,
  rotate: 12,
  transition: { duration: 0.55, ease: EASE_OUT },
};

type ClashCourtroomBubbleProps = {
  turn: DebateTurn;
  userRole: UserRole;
  layout?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Wider cap for judge / bench bubbles */
  wide?: boolean;
};

export function ClashCourtroomBubble({
  turn,
  userRole,
  layout = true,
  className,
  style,
  wide = false,
}: ClashCourtroomBubbleProps) {
  const column = speakerColumn(turn.speaker, userRole);
  const label = speakerLabel(turn.speaker, userRole);
  const isUser = label.startsWith("YOU");
  const badgeLabel = turnBadgeLabel(turn);

  return (
    <motion.div
      layout={layout}
      initial={{ opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={clashBubbleExit}
      transition={{ duration: 0.38, ease: EASE_OUT }}
      className={cn(
        "w-full",
        wide ? "max-w-3xl" : "max-w-[min(100%,22rem)]",
        column === "center" && "mx-auto",
        column === "right" && "ml-auto",
        className
      )}
      style={style}
    >
      <div
        className={cn(
          "rounded-2xl border px-4 py-3 shadow-md backdrop-blur-sm",
          column === "center" &&
            "border-amber-200/90 bg-amber-50/95 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100",
          column === "left" &&
            isUser &&
            "rounded-bl-md border-[#00634B]/25 bg-[#00634B] text-white shadow-[#00634B]/20",
          column === "left" &&
            !isUser &&
            "rounded-bl-md border-slate-200/90 bg-white/95 text-slate-800 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100",
          column === "right" &&
            isUser &&
            "rounded-br-md border-[#00634B]/25 bg-[#00634B] text-white shadow-[#00634B]/20",
          column === "right" &&
            !isUser &&
            "rounded-br-md border-slate-200/90 bg-white/95 text-slate-800 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100"
        )}
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-[0.14em]",
              column === "center"
                ? "text-amber-800 dark:text-amber-200"
                : isUser
                  ? "text-emerald-100"
                  : "text-[#00634B] dark:text-emerald-300"
            )}
          >
            {label}
          </span>
          {badgeLabel && (
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide dark:bg-white/10">
              {badgeLabel}
            </span>
          )}
          {turn.streaming && (
            <span className="size-1.5 animate-pulse rounded-full bg-current opacity-70" />
          )}
        </div>

        {turn.content.trim() ? (
          <p
            className={cn(
              "whitespace-pre-wrap text-[13px] leading-relaxed",
              wide && "max-h-36 overflow-y-auto custom-scrollbar-emerald sm:max-h-44"
            )}
          >
            {turn.content}
          </p>
        ) : null}

        {turn.lawSections && turn.lawSections.length > 0 && (
          <div className="mt-2 flex min-w-0 flex-col gap-1">
            {turn.lawSections.map((section) => (
              <Badge
                key={section}
                variant="outline"
                className={cn(
                  "h-auto max-w-full min-w-0 shrink whitespace-normal break-words rounded-md px-2 py-0.5 text-left text-[10px] leading-snug font-normal",
                  isUser && column !== "center" && "border-white/30 text-emerald-50"
                )}
              >
                {section}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export { MAX_VISIBLE_PER_SIDE };
