"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowDownIcon } from "lucide-react";

type ScrollOptions = { behavior?: ScrollBehavior };

type MessageScrollerContextType = {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: (options?: ScrollOptions) => void;
  scrollToEnd: (options?: ScrollOptions) => void;
  scrollToStart: (options?: ScrollOptions) => void;
  canScrollDown: boolean;
  canScrollUp: boolean;
};

const MessageScrollerContext = React.createContext<MessageScrollerContextType>({
  viewportRef: { current: null },
  scrollToBottom: () => {},
  scrollToEnd: () => {},
  scrollToStart: () => {},
  canScrollDown: false,
  canScrollUp: false,
});

export function useMessageScroller() {
  return React.useContext(MessageScrollerContext);
}

export function useMessageScrollerScrollable() {
  const { canScrollDown, canScrollUp } = useMessageScroller();
  return { start: canScrollUp, end: canScrollDown };
}

export function useMessageScrollerVisibility() {
  const { canScrollDown, canScrollUp } = useMessageScroller();
  return { start: canScrollUp, end: canScrollDown };
}

const NEAR_BOTTOM_PX = 80;

export function MessageScrollerProvider({
  children,
  autoScroll,
  onLeaveBottom,
}: {
  children?: React.ReactNode;
  autoScroll?: boolean;
  onLeaveBottom?: () => void;
  defaultScrollPosition?: string;
  scrollPreviousItemPeek?: number;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = React.useState(false);
  const [canScrollUp, setCanScrollUp] = React.useState(false);
  const autoScrollRef = React.useRef(!!autoScroll);
  const programmaticRef = React.useRef(false);
  const pendingScrollRef = React.useRef<number | null>(null);
  const onLeaveBottomRef = React.useRef(onLeaveBottom);

  React.useEffect(() => {
    autoScrollRef.current = !!autoScroll;
  }, [autoScroll]);

  React.useEffect(() => {
    onLeaveBottomRef.current = onLeaveBottom;
  }, [onLeaveBottom]);

  const checkScroll = React.useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const hasMoreDown = distanceFromBottom > 20;
    const hasMoreUp = el.scrollTop > 20;
    setCanScrollDown(hasMoreDown);
    setCanScrollUp(hasMoreUp);
    return distanceFromBottom;
  }, []);

  const scrollToEnd = React.useCallback((options?: ScrollOptions) => {
    const el = viewportRef.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: options?.behavior || "smooth",
    });
    // Release after the smooth scroll can settle; instant scrolls settle immediately.
    window.setTimeout(
      () => {
        programmaticRef.current = false;
        checkScroll();
      },
      options?.behavior === "auto" ? 32 : 420
    );
  }, [checkScroll]);

  const scrollToStart = React.useCallback((options?: ScrollOptions) => {
    if (viewportRef.current) {
      programmaticRef.current = true;
      viewportRef.current.scrollTo({
        top: 0,
        behavior: options?.behavior || "smooth",
      });
      window.setTimeout(() => {
        programmaticRef.current = false;
        checkScroll();
      }, options?.behavior === "auto" ? 32 : 420);
    }
  }, [checkScroll]);

  const schedulePinToBottom = React.useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (!autoScrollRef.current) return;
      if (pendingScrollRef.current != null) {
        cancelAnimationFrame(pendingScrollRef.current);
      }
      pendingScrollRef.current = requestAnimationFrame(() => {
        pendingScrollRef.current = null;
        scrollToEnd({ behavior });
      });
    },
    [scrollToEnd]
  );

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onScroll = () => {
      const distance = checkScroll() ?? 0;
      if (programmaticRef.current) return;
      if (autoScrollRef.current && distance > NEAR_BOTTOM_PX) {
        onLeaveBottomRef.current?.();
      }
    };

    checkScroll();
    el.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      checkScroll();
      if (autoScrollRef.current) {
        // Instant pin while content grows — overlapping smooth scrolls fight each other.
        schedulePinToBottom("auto");
      }
    });
    resizeObserver.observe(el);
    if (el.firstElementChild) resizeObserver.observe(el.firstElementChild);

    const mutationObserver = new MutationObserver(() => {
      checkScroll();
      if (autoScrollRef.current) {
        schedulePinToBottom("auto");
      }
    });
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (pendingScrollRef.current != null) {
        cancelAnimationFrame(pendingScrollRef.current);
      }
    };
  }, [checkScroll, schedulePinToBottom]);

  // Turning follow on → smooth jump to the live edge.
  React.useEffect(() => {
    if (autoScroll) {
      schedulePinToBottom("smooth");
    }
  }, [autoScroll, schedulePinToBottom]);

  return (
    <MessageScrollerContext.Provider
      value={{
        viewportRef,
        scrollToBottom: scrollToEnd,
        scrollToEnd,
        scrollToStart,
        canScrollDown,
        canScrollUp,
      }}
    >
      {children}
    </MessageScrollerContext.Provider>
  );
}

export function MessageScroller({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative h-full min-h-0 w-full flex-1 overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageScrollerViewport({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { viewportRef } = useMessageScroller();

  return (
    <div
      ref={viewportRef}
      data-slot="message-scroller-viewport"
      className={cn(
        // Absolute fill: height is locked to the parent box so overflow-y can scroll.
        "absolute inset-0 min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain touch-pan-y scrollbar-thin",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageScrollerContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageScrollerItem({
  className,
  children,
  messageId,
  scrollAnchor,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { messageId?: string; scrollAnchor?: boolean }) {
  return (
    <div
      data-slot="message-scroller-item"
      data-message-id={messageId}
      className={cn("min-w-0 shrink-0 overflow-visible", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageScrollerButton({
  direction = "end",
  className,
  children,
  variant = "secondary",
  size = "icon-sm",
  onClick,
  render,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  direction?: "start" | "end";
  variant?: any;
  size?: any;
  render?: any;
}) {
  const { scrollToEnd, scrollToStart } = useMessageScroller();

  return (
    <Button
      variant={variant}
      size={size as any}
      onClick={(e) => {
        if (direction === "end") {
          scrollToEnd({ behavior: "smooth" });
        } else {
          scrollToStart({ behavior: "smooth" });
        }
        onClick?.(e);
      }}
      className={cn("absolute bottom-4 left-1/2 -translate-x-1/2 z-10 shadow-md", className)}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon className="size-4" />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </Button>
  );
}
