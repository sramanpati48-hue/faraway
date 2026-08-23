"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { VoiceInput, type VoiceMode } from "@/components/chat/VoiceInput";

export interface PeerChatMessage {
  id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
}

interface Props {
  threadId: string;
  currentUserId: string;
  peerLabel?: string;
  className?: string;
  compact?: boolean;
  fetchMessages: (threadId: string, after?: string | null) => Promise<PeerChatMessage[]>;
  sendMessage: (threadId: string, body: string) => Promise<PeerChatMessage>;
}

export function PeerChatPane({
  threadId,
  currentUserId,
  peerLabel = "them",
  className,
  compact,
  fetchMessages,
  sendMessage,
}: Props) {
  const [messages, setMessages] = useState<PeerChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollAfter = useRef<string | null>(null);

  const scrollBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const msgs = await fetchMessages(threadId);
      setMessages(msgs);
      pollAfter.current = msgs.length ? msgs[msgs.length - 1].created_at : null;
    } catch (e: any) {
      setError(e.message || "Failed to load chat");
    } finally {
      setLoading(false);
    }
  }, [fetchMessages, threadId]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    scrollBottom();
  }, [messages, scrollBottom]);

  useEffect(() => {
    if (!threadId) return;
    const id = window.setInterval(async () => {
      try {
        const newer = await fetchMessages(threadId, pollAfter.current);
        if (newer.length) {
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id));
            const merged = [...prev];
            for (const m of newer) {
              if (!known.has(m.id)) merged.push(m);
            }
            return merged;
          });
          pollAfter.current = newer[newer.length - 1].created_at;
        }
      } catch {
        /* ignore poll errors */
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [threadId, fetchMessages]);

  const onSend = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendMessage(threadId, text);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      pollAfter.current = msg.created_at;
      setDraft("");
    } catch (e: any) {
      setError(e.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleVoiceTranscription = (text: string, mode: VoiceMode) => {
    const cleaned = (text || "").trim();
    if (!cleaned) return;
    if (mode === "dictation") {
      setDraft((prev) => (prev ? `${prev.trim()} ${cleaned}` : cleaned));
      return;
    }
    // Conversation mode: send transcribed text as the chat message
    void onSend(cleaned);
  };

  return (
    <div className={cn("flex flex-col min-h-0 bg-white", className)}>
      <div
        className={cn(
          "flex-1 overflow-y-auto space-y-2.5 px-3 sm:px-4",
          compact ? "py-3" : "py-4"
        )}
      >
        {loading ? (
          <div className="flex h-full min-h-[120px] items-center justify-center text-[#00634B]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center px-4 text-center">
            <p className="text-sm text-gray-500">
              Start the conversation with {peerLabel}. Keep it concise and professional.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = String(m.sender_user_id) === String(currentUserId);
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    mine
                      ? "bg-[#00634B] text-white rounded-br-md"
                      : "bg-[#F0F4F3] text-gray-800 rounded-bl-md"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={cn(
                      "mt-1 text-[10px]",
                      mine ? "text-white/70" : "text-gray-400"
                    )}
                  >
                    {m.created_at
                      ? new Date(m.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 text-xs text-red-600 bg-red-50 py-1.5 border-t border-red-100">{error}</p>
      )}

      <div className="border-t border-gray-100 p-3 sm:p-4 flex gap-2 items-end bg-[#F8F9FA]">
        <div className="pb-0.5 flex-shrink-0">
          <VoiceInput onTranscription={handleVoiceTranscription} isProcessing={sending} />
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          rows={compact ? 1 : 2}
          placeholder="Type a message or use the mic…"
          className="flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00634B]/30 focus:border-[#00634B]"
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={sending || !draft.trim()}
          className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[#00634B] text-white flex items-center justify-center disabled:opacity-50 hover:bg-[#004D3C] transition-colors flex-shrink-0"
          aria-label="Send message"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
