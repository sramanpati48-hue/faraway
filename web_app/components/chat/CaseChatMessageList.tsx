"use client";

import type { ReactNode } from "react";
import { ClipboardList, Scale, ShieldAlert, Users } from "lucide-react";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { CaseChatMessage, type CaseChatMessageData } from "@/components/chat/CaseChatMessage";
import { CaseChatScroller } from "@/components/chat/CaseChatScroller";
import { CaseThinkingIndicator } from "@/components/chat/CaseThinkingIndicator";
import { cn } from "@/lib/utils";

import { VoiceModeratorPrompt } from "@/components/voice/VoiceModeratorPrompt";
import { NyayGuideDispatchCard } from "@/components/nyayguide/NyayGuideDispatchCard";
import type { NyayGuideRequest } from "@/lib/nyayguideApi";

export type ForwardedQueueState = {
  role: "moderator" | "lawyer" | "sahayak" | "nodal_guide" | string;
  roleLabel: string;
  targetId: string;
  caseId?: string | null;
  queueStatus: string;
  followUps?: { statement: string; created_at?: string }[];
};

function queueIcon(role: string) {
  if (role === "lawyer") return Scale;
  if (role === "sahayak" || role === "nodal_guide") return Users;
  return ShieldAlert;
}

function isActiveForwardQueue(queue: ForwardedQueueState | null | undefined): boolean {
  if (!queue?.role) return false;
  const status = (queue.queueStatus || "queued").toLowerCase();
  return status !== "resolved" && status !== "reviewed";
}

function queueCopy(forwarded: ForwardedQueueState) {
  const role = forwarded.roleLabel || "reviewer";
  const status = (forwarded.queueStatus || "queued").toLowerCase();
  if (status === "accepted") {
    return {
      title: `Accepted by ${role}`,
      body: `Your case is with this ${role.toLowerCase()}. Add a follow-up below and it will be attached to the forwarded summary.`,
    };
  }
  if (String(forwarded.role || "").toLowerCase() === "nodal_guide" || status === "queued") {
    return {
      title: `Forwarded · waiting for review`,
      body: `Your case is in the ${role} queue. Anything you send now is added as a follow-up to the summary already forwarded.`,
    };
  }
  return {
    title: `Forwarded to ${role}`,
    body: `This case is in the ${role} queue for review. Anything you send now is added as a follow-up to the summary already forwarded.`,
  };
}

type CaseChatMessageListProps = {
  messages: CaseChatMessageData[];
  isLoading: boolean;
  structuredReport: any;
  suggestedActions: any[];
  copiedIndex: number | null;
  currentCasePending: boolean;
  caseId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  manualVoiceModeratorTrigger?: boolean;
  onCloseVoiceModerator?: () => void;
  onContextRefined?: (updated: any) => void;
  nyayGuideRequest?: NyayGuideRequest | null;
  showNyayGuideCard?: boolean;
  onCloseNyayGuideCard?: () => void;
  onNyayGuideRequestCreated?: (request: NyayGuideRequest) => void;
  onNyayGuideRequestCancelled?: () => void;
  forwardedQueue?: ForwardedQueueState | null;
  locationBanner?: ReactNode;
  bottomPaddingClass?: string;
  jumpButtonClassName?: string;
  handleCopy: (text: string, index: number) => void;
  handleChecklistSelect: (item: string) => void;
  handleAction: (action: any) => void;
};

export function CaseChatMessageList({
  messages,
  isLoading,
  structuredReport,
  suggestedActions,
  copiedIndex,
  currentCasePending: _currentCasePending,
  caseId,
  userId,
  sessionId,
  manualVoiceModeratorTrigger,
  onCloseVoiceModerator,
  onContextRefined,
  nyayGuideRequest,
  showNyayGuideCard,
  onCloseNyayGuideCard,
  onNyayGuideRequestCreated,
  onNyayGuideRequestCancelled,
  forwardedQueue,
  locationBanner,
  bottomPaddingClass,
  jumpButtonClassName,
  handleCopy,
  handleChecklistSelect,
  handleAction,
}: CaseChatMessageListProps) {
  const showThinking =
    isLoading && messages.length > 0 && messages[messages.length - 1]?.role === "user";
  // If NyayGuide dispatch is active or requested, do not render generic static forward card for guides
  const isGuideQueue = String(forwardedQueue?.role || "").toLowerCase() === "nodal_guide" || String(forwardedQueue?.role || "").toLowerCase() === "nyayguide";
  const queue = !showNyayGuideCard && !nyayGuideRequest && isActiveForwardQueue(forwardedQueue) && !isGuideQueue ? forwardedQueue! : null;
  const copy = queue ? queueCopy(queue) : null;
  const Icon = queue ? queueIcon(queue.role) : ShieldAlert;
  const followCount = queue?.followUps?.length || 0;

  return (
    <CaseChatScroller
      isStreaming={isLoading}
      contentClassName={cn(bottomPaddingClass)}
      jumpButtonClassName={jumpButtonClassName}
    >
      {locationBanner}

      {messages.map((msg, i) => (
        <MessageScrollerItem
          key={`msg-${i}`}
          messageId={`msg-${i}`}
          scrollAnchor={msg.role === "user"}
        >
          <CaseChatMessage
            msg={msg}
            index={i}
            isLast={i === messages.length - 1}
            isNew={i >= messages.length - 2}
            isStreaming={isLoading && i === messages.length - 1 && msg.role === "assistant"}
            structuredReport={structuredReport}
            suggestedActions={suggestedActions}
            copiedIndex={copiedIndex}
            handleCopy={handleCopy}
            handleChecklistSelect={handleChecklistSelect}
            handleAction={handleAction}
          />
        </MessageScrollerItem>
      ))}

      {manualVoiceModeratorTrigger && (
        <MessageScrollerItem messageId="voice-moderator-prompt">
          <VoiceModeratorPrompt
            caseId={caseId || sessionId || "active-case"}
            userId={userId}
            sessionId={sessionId}
            contextBuildingResult={structuredReport || {}}
            transcript={messages}
            manualTalkTrigger={manualVoiceModeratorTrigger}
            onClose={onCloseVoiceModerator}
            onContextRefined={onContextRefined}
          />
        </MessageScrollerItem>
      )}

      {(showNyayGuideCard || nyayGuideRequest) && (
        <MessageScrollerItem messageId="nyayguide-dispatch-card">
          <NyayGuideDispatchCard
            caseId={caseId || sessionId || "active-case"}
            structuredReport={structuredReport}
            initialRequest={nyayGuideRequest}
            onClose={onCloseNyayGuideCard}
            onRequestCreated={onNyayGuideRequestCreated}
            onRequestCancelled={onNyayGuideRequestCancelled}
          />
        </MessageScrollerItem>
      )}

      {showThinking && (
        <MessageScrollerItem messageId="thinking">
          <CaseThinkingIndicator />
        </MessageScrollerItem>
      )}

      {queue && copy && (
        <MessageScrollerItem messageId="forwarded-queue">
          <Marker
            variant="border"
            className="rounded-2xl border-amber-300 bg-amber-50 px-4 py-3.5 shadow-[0_8px_24px_-12px_rgba(180,83,9,0.45)] ring-1 ring-amber-200 dark:border-amber-800 dark:bg-amber-950/40 dark:ring-amber-800/80"
          >
            <MarkerIcon className="text-amber-700 dark:text-amber-300">
              <Icon className="size-4" />
            </MarkerIcon>
            <MarkerContent className="text-left">
              <span className="block text-sm font-semibold tracking-tight text-amber-950 dark:text-amber-100">
                {copy.title}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                {copy.body}
              </span>
              {followCount > 0 && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                  <ClipboardList className="size-3" />
                  {followCount} follow-up{followCount === 1 ? "" : "s"} on the case
                </span>
              )}
            </MarkerContent>
          </Marker>
        </MessageScrollerItem>
      )}

      <div className="h-4 shrink-0" aria-hidden />
    </CaseChatScroller>
  );
}

