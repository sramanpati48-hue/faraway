"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Inbox,
  MapPin,
  MessageSquare,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { markChatThreadRead } from "@/lib/sahayakChatApi";
import { scamHeatmapHref } from "@/lib/scamsApi";
import { useNearbyScamAlerts } from "@/hooks/useUserLocation";
import { refreshUnreadChat, unreadItemsToNotifications, useUnreadChat } from "@/hooks/useUnreadChat";
import { focusRing, touchIconButton } from "@/lib/motion";
import { cn } from "@/lib/utils";

type InboxNotification = {
  id: string;
  title: string;
  message: string;
  time: string;
  type: "scam" | "message" | "case" | "location";
  read: boolean;
  payload?: string;
  href?: string;
  channel?: "lawyer" | "sahayak";
  threadId?: string;
};

type NotificationsInboxProps = {
  className?: string;
  /** Dropdown opens left when space is tight (e.g. sidebar edge). */
  align?: "left" | "right";
};

export function NotificationsInbox({
  className,
  align = "left",
}: NotificationsInboxProps) {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = useUnreadChat();
  const [messageNotifications, setMessageNotifications] = useState<InboxNotification[]>([]);
  const { scamNotifications, setScamNotifications, areaLabel, locationStatus } =
    useNearbyScamAlerts();

  const notifications = useMemo(
    () => [...messageNotifications, ...scamNotifications],
    [messageNotifications, scamNotifications]
  );
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    setMessageNotifications(unreadItemsToNotifications(unread));
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPanelPosition(null);
      return;
    }

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const panelWidth = Math.min(320, window.innerWidth - 32);
      const gap = 8;
      const viewportPadding = 16;
      const left =
        align === "right"
          ? rect.right - panelWidth
          : rect.left;
      const clampedLeft = Math.min(
        Math.max(viewportPadding, left),
        window.innerWidth - panelWidth - viewportPadding
      );

      setPanelPosition({ top: rect.bottom + gap, left: clampedLeft });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, align]);

  const markAllRead = () => {
    setScamNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setMessageNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (accessToken) {
      const marks = messageNotifications
        .filter((n) => n.channel && n.threadId)
        .map((n) => markChatThreadRead(accessToken, n.channel!, n.threadId!));
      void Promise.all(marks).finally(() => refreshUnreadChat());
    }
  };

  const openNotification = (notif: InboxNotification) => {
    if (notif.type === "message") {
      setMessageNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
      if (accessToken && notif.channel && notif.threadId) {
        void markChatThreadRead(accessToken, notif.channel, notif.threadId).finally(() =>
          refreshUnreadChat()
        );
      }
    } else {
      setScamNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
    }
    setOpen(false);
    if (notif.href) {
      router.push(notif.href);
      return;
    }
    if (notif.type === "scam" && notif.payload) {
      try {
        const payloadData = JSON.parse(notif.payload) as {
          lat: number;
          lon: number;
          title: string;
        };
        router.push(scamHeatmapHref(payloadData));
        return;
      } catch {
        /* fall through */
      }
    }
    router.push("/scam-heatmap");
  };

  return (
    <div className={cn("relative h-11 w-11 shrink-0 md:h-10 md:w-10", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          touchIconButton,
          focusRing,
          "relative rounded-lg border border-[#00634B]/20 bg-white text-[#00634B] hover:border-[#00634B]/40 hover:bg-[#E6F0ED]",
          open && "border-[#00634B]/40 bg-[#E6F0ED]"
        )}
      >
        <Inbox className="h-[18px] w-[18px] text-[#00634B]" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F57C00] px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open &&
        panelPosition &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Notifications"
              style={{
                top: panelPosition.top,
                left: panelPosition.left,
              }}
              className="fixed z-[110] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-lg shadow-slate-900/10"
            >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-emerald-50/40 px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Inbox</p>
                <p className="truncate text-[10px] text-slate-500">
                  {messageNotifications.length > 0
                    ? `${messageNotifications.length} chat update${messageNotifications.length === 1 ? "" : "s"}`
                    : locationStatus === "loading"
                      ? "Finding scams near you…"
                      : locationStatus === "denied"
                        ? "Location access needed"
                        : areaLabel
                          ? `Scams near ${areaLabel}`
                          : "Alerts & messages"}
                </p>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className={cn(
                    "shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#00634B] hover:underline",
                    focusRing,
                    "rounded-sm"
                  )}
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
              {locationStatus === "loading" && notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Inbox className="mx-auto mb-2 h-8 w-8 animate-pulse text-slate-200" />
                  <p className="text-sm text-slate-400">Loading alerts…</p>
                </div>
              ) : notifications.length > 0 ? (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "cursor-pointer border-b border-slate-50 p-3.5 transition-colors hover:bg-slate-50",
                      !notif.read && "bg-emerald-50/30",
                      focusRing
                    )}
                    onClick={() => openNotification(notif)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openNotification(notif);
                      }
                    }}
                  >
                    <div className="flex gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          notif.type === "scam"
                            ? "bg-orange-100 text-orange-600"
                            : notif.type === "location"
                              ? "bg-amber-100 text-amber-700"
                              : notif.type === "message"
                                ? "bg-blue-100 text-blue-600"
                                : "bg-emerald-100 text-emerald-600"
                        )}
                      >
                        {notif.type === "scam" ? (
                          <ShieldAlert className="h-4 w-4" />
                        ) : notif.type === "location" ? (
                          <MapPin className="h-4 w-4" />
                        ) : notif.type === "message" ? (
                          <MessageSquare className="h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {notif.title}
                          </p>
                          {!notif.read && (
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                          )}
                        </div>
                        <p className="mb-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                          {notif.message}
                        </p>
                        <p className="text-[10px] font-medium text-slate-400">{notif.time}</p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center">
                  <Inbox className="mx-auto mb-2 h-8 w-8 text-slate-200" />
                  <p className="text-sm text-slate-400">No alerts right now</p>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 p-2.5 text-center">
              <button
                type="button"
                className={cn(
                  "text-xs font-semibold text-slate-500 transition-colors hover:text-[#00634B]",
                  focusRing,
                  "rounded-sm"
                )}
                onClick={() => {
                  setOpen(false);
                  router.push("/scam-heatmap");
                }}
              >
                Open scam heatmap
              </button>
            </div>
          </div>
          </>,
          document.body
        )}
    </div>
  );
}
