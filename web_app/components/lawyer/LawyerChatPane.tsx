"use client";

import { useCallback } from "react";
import { PeerChatPane } from "@/components/chat/PeerChatPane";
import { fetchLawyerMessages, sendLawyerMessage } from "@/lib/lawyerChatApi";

interface Props {
  threadId: string;
  accessToken: string;
  currentUserId: string;
  peerLabel?: string;
  className?: string;
  compact?: boolean;
}

export function LawyerChatPane({
  threadId,
  accessToken,
  currentUserId,
  peerLabel = "them",
  className,
  compact,
}: Props) {
  const fetchMessages = useCallback(
    (tid: string, after?: string | null) => fetchLawyerMessages(accessToken, tid, after),
    [accessToken]
  );
  const sendMessage = useCallback(
    (tid: string, body: string) => sendLawyerMessage(accessToken, tid, body),
    [accessToken]
  );

  return (
    <PeerChatPane
      threadId={threadId}
      currentUserId={currentUserId}
      peerLabel={peerLabel}
      className={className}
      compact={compact}
      fetchMessages={fetchMessages}
      sendMessage={sendMessage}
    />
  );
}
