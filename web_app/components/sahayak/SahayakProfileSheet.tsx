"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X, MapPin, Phone, Mail, HeartHandshake, MessageCircle,
  CheckCircle, Loader2, Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SahayakProfile } from "@/lib/sahayakTypes";
import { sahayakIdOf } from "@/lib/sahayakTypes";
import { SahayakChatPane } from "./SahayakChatPane";
import { connectSahayakThread } from "@/lib/sahayakChatApi";

interface Props {
  sahayak: SahayakProfile | null;
  open: boolean;
  onClose: () => void;
  accessToken?: string | null;
  currentUserId?: string | null;
  sahayakCaseId?: string | null;
  victimUserId?: string | null;
  onConnected?: (payload: { threadId: string; sahayak: SahayakProfile }) => void;
  onConnectLegacy?: (sahayak: SahayakProfile) => void | Promise<void>;
  initialMode?: "profile" | "chat";
  initialThreadId?: string | null;
  showConnect?: boolean;
}

export function SahayakProfileSheet({
  sahayak,
  open,
  onClose,
  accessToken,
  currentUserId,
  sahayakCaseId,
  victimUserId,
  onConnected,
  onConnectLegacy,
  initialMode = "profile",
  initialThreadId = null,
  showConnect = true,
}: Props) {
  const [mode, setMode] = useState<"profile" | "chat">(initialMode);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialThreadId ? "chat" : initialMode);
    setThreadId(initialThreadId ? String(initialThreadId) : null);
    setError(null);
  }, [open, sahayak?.uid, sahayak?.id, initialMode, initialThreadId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !sahayak) return null;

  const area = sahayak.location || [sahayak.city, sahayak.state].filter(Boolean).join(", ");
  const langs = sahayak.languages || [];

  const handleConnect = async () => {
    if (!accessToken || !currentUserId) {
      setError("Please sign in to connect with this Nyay Guide.");
      return;
    }
    const sid = sahayakIdOf(sahayak);
    if (!sid) {
      setError("Guide profile is missing an id.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      if (onConnectLegacy) await onConnectLegacy(sahayak);
      const { thread } = await connectSahayakThread(accessToken, {
        sahayakUserId: sid,
        sahayakCaseId: sahayakCaseId || undefined,
        victimUserId: victimUserId || undefined,
        initialMessage: sahayakCaseId
          ? "Hello — I’d like guidance on my case."
          : "Hello — I’d like to connect with a Nyay Guide in my area.",
      });
      setThreadId(String(thread.id));
      setMode("chat");
      onConnected?.({ threadId: String(thread.id), sahayak });
    } catch (e: any) {
      setError(e.message || "Could not connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex w-full flex-col bg-white shadow-2xl overflow-hidden",
          "max-h-[92dvh] sm:max-h-[88vh]",
          "rounded-t-3xl sm:rounded-3xl",
          "sm:max-w-2xl sm:mx-4",
          "animate-in slide-in-from-bottom-4 sm:fade-in sm:zoom-in-95 duration-200"
        )}
      >
        <div className="relative h-24 sm:h-28 bg-gradient-to-r from-[#00634B] to-[#0A8F6C] flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 h-9 w-9 rounded-xl bg-black/30 text-white flex items-center justify-center hover:bg-black/45"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute -bottom-10 left-4 sm:left-6">
            {sahayak.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sahayak.avatar}
                alt={sahayak.name}
                className="h-20 w-20 rounded-2xl border-4 border-white object-cover shadow-lg"
              />
            ) : (
              <div className="h-20 w-20 rounded-2xl border-4 border-white bg-[#E6F0ED] flex items-center justify-center text-2xl font-black text-[#00634B] shadow-lg">
                {(sahayak.name || "G").charAt(0)}
              </div>
            )}
          </div>
        </div>

        <div className="pt-12 px-4 sm:px-6 pb-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-black text-gray-900 truncate">{sahayak.name}</h2>
              <p className="text-sm font-semibold text-[#00634B] mt-0.5">
                {sahayak.occupation || "Nyay Guide"}
              </p>
              {area && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
                  <MapPin className="w-3 h-3" /> {area}
                </p>
              )}
            </div>
            <div className="flex rounded-xl bg-[#F0F4F3] p-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => setMode("profile")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                  mode === "profile" ? "bg-white text-[#00634B] shadow-sm" : "text-gray-500"
                )}
              >
                Profile
              </button>
              <button
                type="button"
                onClick={() => threadId && setMode("chat")}
                disabled={!threadId}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                  mode === "chat" ? "bg-white text-[#00634B] shadow-sm" : "text-gray-500",
                  !threadId && "opacity-40 cursor-not-allowed"
                )}
              >
                Chat
              </button>
            </div>
          </div>
        </div>

        {mode === "profile" ? (
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5 min-h-0">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-[#F8F9FA] border border-gray-100 p-3 text-center">
                <p className="text-sm font-black text-gray-900">{(sahayak.rating ?? 4.5).toFixed(1)}★</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Rating</p>
              </div>
              <div className="rounded-2xl bg-[#F8F9FA] border border-gray-100 p-3 text-center">
                <p className="text-sm font-black text-gray-900">{sahayak.cases_resolved ?? 0}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Helped</p>
              </div>
              <div className="rounded-2xl bg-[#F8F9FA] border border-gray-100 p-3 text-center">
                <p className="text-sm font-black text-gray-900">{langs.length || "—"}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Languages</p>
              </div>
            </div>

            {sahayak.bio && (
              <section>
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">About</h3>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{sahayak.bio}</p>
              </section>
            )}

            {langs.length > 0 && (
              <section>
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Languages</h3>
                <div className="flex flex-wrap gap-1.5">
                  {langs.map((l) => (
                    <span key={l} className="rounded-lg bg-[#E6F0ED] text-[#00634B] text-xs font-bold px-2.5 py-1">
                      {l}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Details</h3>
              <div className="space-y-2.5 text-sm">
                {sahayak.availability && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <HeartHandshake className="w-4 h-4 text-[#00634B]" />
                    <span>{sahayak.availability}</span>
                  </div>
                )}
                {sahayak.email && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Mail className="w-4 h-4 text-[#00634B]" />
                    <span className="truncate">{sahayak.email}</span>
                  </div>
                )}
                {sahayak.contact_number && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Phone className="w-4 h-4 text-[#00634B]" />
                    <span>{sahayak.contact_number}</span>
                  </div>
                )}
                {area && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Globe className="w-4 h-4 text-[#00634B]" />
                    <span>{area}</span>
                  </div>
                )}
              </div>
            </section>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
            )}
          </div>
        ) : threadId && accessToken && currentUserId ? (
          <SahayakChatPane
            threadId={threadId}
            accessToken={accessToken}
            currentUserId={currentUserId}
            peerLabel={sahayak.name.split(" ")[0]}
            className="flex-1 min-h-[280px]"
          />
        ) : null}

        {mode === "profile" && showConnect && (
          <div className="flex-shrink-0 border-t border-gray-100 p-4 sm:p-5 bg-[#F8F9FA] flex flex-col gap-2">
            {!accessToken && (
              <p className="text-xs text-gray-500 text-center sm:text-left">
                Sign in as a client to connect with this guide.{" "}
                <Link href="/login?next=/find-help" className="font-bold text-[#00634B] hover:underline">
                  Log in
                </Link>
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              {threadId && accessToken && currentUserId ? (
                <button
                  type="button"
                  onClick={() => setMode("chat")}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3 text-sm transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Open chat
                </button>
              ) : !accessToken ? (
                <Link
                  href="/login?next=/find-help"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3 text-sm transition-colors"
                >
                  Log in to connect
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#00634B] hover:bg-[#004D3C] text-white font-bold py-3 text-sm transition-colors disabled:opacity-60"
                >
                  {connecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  Connect & chat
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="sm:w-auto px-5 rounded-2xl border border-gray-200 bg-white text-gray-700 font-bold py-3 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
