"use client";

import { useCallback } from "react";
import { PeerChatPane } from "@/components/chat/PeerChatPane";
import { fetchSahayakMessages, sendSahayakMessage } from "@/lib/sahayakChatApi";

interface Props {
  threadId: string;
  accessToken: string;
  currentUserId: string;
  peerLabel?: string;
  className?: string;
  compact?: boolean;
}

export function SahayakChatPane({
  threadId,
  accessToken,
  currentUserId,
  peerLabel = "them",
  className,
  compact,
}: Props) {
  const fetchMessages = useCallback(
    (tid: string, after?: string | null) => fetchSahayakMessages(accessToken, tid, after),
    [accessToken]
  );
  const sendMessage = useCallback(
    (tid: string, body: string) => sendSahayakMessage(accessToken, tid, body),
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
