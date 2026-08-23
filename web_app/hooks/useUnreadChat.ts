"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchUnreadChat, type UnreadChatPayload } from "@/lib/sahayakChatApi";

const POLL_MS = 30_000;

type Listener = (data: UnreadChatPayload | null) => void;

const listeners = new Set<Listener>();
let timer: number | null = null;
let visBound = false;
let lastToken: string | null = null;
let lastData: UnreadChatPayload | null = null;
let pending: Promise<void> | null = null;

function notify(data: UnreadChatPayload | null) {
  lastData = data;
  listeners.forEach((fn) => fn(data));
}

async function tick() {
  if (pending) return pending;
  if (!lastToken) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

  pending = (async () => {
    try {
      const data = await fetchUnreadChat(lastToken!);
      notify(data);
    } catch {
      /* ignore poll errors */
    }
  })();

  try {
    await pending;
  } finally {
    pending = null;
  }
}

function ensureTimer() {
  if (typeof window === "undefined") return;
  if (timer == null) {
    timer = window.setInterval(() => void tick(), POLL_MS);
  }
  if (!visBound) {
    visBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && listeners.size > 0) void tick();
    });
  }
}

function stopTimer() {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function subscribeUnreadChat(token: string | null, onData: Listener): () => void {
  listeners.add(onData);
  if (lastData) onData(lastData);

  if (!token) {
    lastToken = null;
    stopTimer();
    onData(null);
  } else {
    const tokenChanged = lastToken !== token;
    lastToken = token;
    if (tokenChanged || !lastData) void tick();
    ensureTimer();
  }

  return () => {
    listeners.delete(onData);
    if (listeners.size === 0) {
      stopTimer();
      lastToken = null;
      lastData = null;
    }
  };
}

export function refreshUnreadChat() {
  void tick();
}

export function unreadItemsToNotifications(data: UnreadChatPayload | null) {
  if (!data) return [];
  return (data.items || []).map((item) => ({
    id: `msg-${item.channel}-${item.thread_id}`,
    title: `New message from ${item.peer_name}`,
    message: item.last_message || "Open to continue the conversation.",
    time: item.last_message_at
      ? new Date(item.last_message_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Just now",
    type: "message" as const,
    read: false,
    href: item.href,
    channel: item.channel as "lawyer" | "sahayak",
    threadId: item.thread_id,
  }));
}

export function useUnreadChat() {
  const { accessToken, user } = useAuth();
  const [data, setData] = useState<UnreadChatPayload | null>(null);

  useEffect(() => {
    if (!user?.uid || !accessToken) {
      setData(null);
      return;
    }
    return subscribeUnreadChat(accessToken, setData);
  }, [accessToken, user?.uid]);

  return data;
}
