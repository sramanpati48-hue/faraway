"use client";

import Image from "next/image";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { cn } from "@/lib/utils";

type CaseThinkingIndicatorProps = {
  label?: string;
  className?: string;
};

export function CaseThinkingIndicator({
  label = "Analyzing your case…",
  className,
}: CaseThinkingIndicatorProps) {
  return (
    <Message align="start" className={cn("max-w-3xl mx-auto w-full motion-enter-fade", className)}>
      <MessageAvatar className="!translate-y-0 size-10 self-start rounded-xl border border-[#00634B]/15 bg-[#E6F0ED] p-1.5 shadow-sm dark:border-emerald-500/20 dark:bg-emerald-900/30">
        <div className="relative size-full">
          <Image src="/3.png" alt="" fill className="object-contain dark:hidden" />
          <Image src="/2.png" alt="" fill className="object-contain hidden dark:block" />
        </div>
      </MessageAvatar>
      <MessageContent className="max-w-[85%]">
        <Bubble variant="outline" className="max-w-full">
          <BubbleContent className="rounded-2xl rounded-tl-md border-slate-200/90 bg-white px-5 py-4 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)] dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00634B]/30 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00634B]" />
              </span>
              <p className="chat-shimmer text-sm font-medium">{label}</p>
            </div>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
