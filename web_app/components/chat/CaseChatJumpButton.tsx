"use client";

import { ArrowDown } from "lucide-react";
import {
  useMessageScroller,
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";

type CaseChatJumpButtonProps = {
  onFollowLive: () => void;
  className?: string;
};

export function CaseChatJumpButton({ onFollowLive, className }: CaseChatJumpButtonProps) {
  const { scrollToEnd } = useMessageScroller();
  const { end: canScrollDown } = useMessageScrollerScrollable();

  return (
    <button
      type="button"
      aria-label="Jump to latest message"
      inert={!canScrollDown}
      tabIndex={canScrollDown ? 0 : -1}
      data-active={canScrollDown ? "true" : "false"}
      onClick={() => {
        onFollowLive();
        requestAnimationFrame(() => {
          scrollToEnd({ behavior: "smooth" });
        });
      }}
      className={cn(
        "absolute left-1/2 z-30 flex size-10 -translate-x-1/2 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm transition-[transform,opacity,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        "border-slate-200/90 bg-white/95 text-slate-700 hover:bg-white hover:shadow-xl",
        "dark:border-slate-600/90 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:bg-slate-800",
        "data-[active=false]:pointer-events-none data-[active=false]:translate-y-3 data-[active=false]:opacity-0",
        "data-[active=true]:translate-y-0 data-[active=true]:opacity-100",
        className
      )}
    >
      <ArrowDown className="size-4" strokeWidth={2.25} />
    </button>
  );
}
