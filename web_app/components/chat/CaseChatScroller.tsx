"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { CaseChatJumpButton } from "@/components/chat/CaseChatJumpButton";
import { cn } from "@/lib/utils";

type CaseChatScrollerProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Force follow even when not streaming. */
  autoScroll?: boolean;
  isStreaming?: boolean;
  scrollPreviousItemPeek?: number;
  jumpButtonClassName?: string;
};

export function CaseChatScroller({
  children,
  className,
  contentClassName,
  autoScroll = false,
  isStreaming = false,
  scrollPreviousItemPeek = 64,
  jumpButtonClassName,
}: CaseChatScrollerProps) {
  const [followLive, setFollowLive] = useState(true);

  // New / ongoing reply → keep the live edge in view.
  useEffect(() => {
    if (isStreaming) setFollowLive(true);
  }, [isStreaming]);

  const onLeaveBottom = useCallback(() => {
    setFollowLive(false);
  }, []);

  return (
    <div className="absolute inset-0 min-h-0">
      <MessageScrollerProvider
        autoScroll={autoScroll || followLive}
        onLeaveBottom={onLeaveBottom}
        defaultScrollPosition="last-anchor"
        scrollPreviousItemPeek={scrollPreviousItemPeek}
      >
        <MessageScroller className={cn("relative h-full w-full", className)}>
          <MessageScrollerViewport className="custom-scrollbar px-4 md:px-8">
            <MessageScrollerContent
              aria-busy={isStreaming}
              className={cn("mx-auto w-full max-w-3xl gap-8 py-1", contentClassName)}
            >
              {children}
            </MessageScrollerContent>
          </MessageScrollerViewport>

          <CaseChatJumpButton
            onFollowLive={() => setFollowLive(true)}
            className={cn("bottom-36 sm:bottom-40", jumpButtonClassName)}
          />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}
