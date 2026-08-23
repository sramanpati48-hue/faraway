"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ClashEntry } from "@/hooks/useClashStream";
import type { AgentSide, UserAction } from "@/lib/clashApi";
import { ClashMessageBubble } from "./ClashMessageBubble";
import { ClashQuestionCard } from "./ClashQuestionCard";
import { ClashActivityBlock } from "./ClashActivityBlock";
import { ClashParametersPanel } from "./ClashParametersPanel";
import { ClashRoundScoreCard } from "./ClashRoundScoreCard";
import { ClashJudgmentCard } from "./ClashJudgmentCard";

type FeedItem =
  | { type: "entry"; entry: ClashEntry }
  | {
      type: "activity";
      id: string;
      side: AgentSide;
      phase?: string;
      rag: Extract<ClashEntry, { kind: "rag" }> | null;
      reasoning: Extract<ClashEntry, { kind: "reasoning" }>[];
      /** Id of the stream entry this activity precedes, if any */
      streamId?: string;
    };

/**
 * Group consecutive rag + reasoning for the same side into an activity block,
 * attached to the following stream entry from that side when present.
 */
export function groupEntries(entries: ClashEntry[]): FeedItem[] {
  const out: FeedItem[] = [];
  let i = 0;

  while (i < entries.length) {
    const e = entries[i];

    if (e.kind === "rag" || e.kind === "reasoning") {
      const side = e.side;
      const phase = e.phase;
      let rag: Extract<ClashEntry, { kind: "rag" }> | null = null;
      const reasoning: Extract<ClashEntry, { kind: "reasoning" }>[] = [];
      const ids: string[] = [];

      while (i < entries.length) {
        const cur = entries[i];
        if (cur.kind === "rag" && cur.side === side) {
          rag = cur;
          ids.push(cur.id);
          i += 1;
          continue;
        }
        if (cur.kind === "reasoning" && cur.side === side) {
          reasoning.push(cur);
          ids.push(cur.id);
          i += 1;
          continue;
        }
        break;
      }

      let streamId: string | undefined;
      const next = i < entries.length ? entries[i] : null;
      if (next && next.kind === "stream" && next.side === side) {
        streamId = next.id;
      }

      out.push({
        type: "activity",
        id: `activity-${ids[0] ?? side}-${ids.length}`,
        side,
        phase: phase || reasoning[0]?.phase || rag?.phase,
        rag,
        reasoning,
        streamId,
      });
      continue;
    }

    out.push({ type: "entry", entry: e });
    i += 1;
  }

  return out;
}

function argumentStartedFor(
  item: Extract<FeedItem, { type: "activity" }>,
  entries: ClashEntry[]
): boolean {
  if (item.streamId) {
    const stream = entries.find((e) => e.id === item.streamId);
    if (stream && stream.kind === "stream") {
      // Collapse once tokens arrive (or stream finalized empty edge-case)
      return Boolean(stream.content) || stream.finalized;
    }
  }
  const firstId = item.rag?.id || item.reasoning[0]?.id;
  if (!firstId) return false;
  let seen = false;
  for (const e of entries) {
    if (e.id === firstId) seen = true;
    if (!seen) continue;
    if (e.kind === "stream" && e.side === item.side && e.content) return true;
  }
  return false;
}

function isLiveActivity(
  item: Extract<FeedItem, { type: "activity" }>,
  entries: ClashEntry[],
  isStreaming: boolean
): boolean {
  if (!isStreaming) return false;

  if (item.streamId) {
    const stream = entries.find((e) => e.id === item.streamId);
    if (stream && stream.kind === "stream") {
      // Still "live thinking" only until argument content begins
      return !stream.content && !stream.finalized;
    }
    return false;
  }

  // No stream yet — live if nothing terminal has arrived after this group's steps
  const anchorId = item.rag?.id || item.reasoning[0]?.id;
  if (!anchorId) return isStreaming;

  let passed = false;
  for (const e of entries) {
    if (e.id === anchorId || item.reasoning.some((r) => r.id === e.id) || e.id === item.rag?.id) {
      passed = true;
      continue;
    }
    if (!passed) continue;
    if (e.kind === "stream" && e.side === item.side) {
      return !e.content && !e.finalized;
    }
    if (
      e.kind === "round_score" ||
      e.kind === "judge_verdict" ||
      e.kind === "final" ||
      e.kind === "question" ||
      e.kind === "cross_answer" ||
      ((e.kind === "rag" || e.kind === "reasoning") && e.side !== item.side)
    ) {
      return false;
    }
  }
  return true;
}

export function ClashDebateTranscript({
  entries,
  isStreaming,
  pendingQuestion,
  onSubmitAnswer,
}: {
  entries: ClashEntry[];
  isStreaming: boolean;
  pendingQuestion: {
    questionId: string;
    text: string;
    side: AgentSide;
    phase?: string;
    lawSections?: string[];
    questionTarget: "user" | "prosecution" | "defence";
    userAction: UserAction;
    aiAssistAllowed: boolean;
  } | null;
  onSubmitAnswer: (
    questionId: string,
    answer: string,
    options?: { delegate?: boolean }
  ) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const feed = useMemo(() => groupEntries(entries), [entries]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, isStreaming, pendingQuestion, feed.length]);

  return (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4 custom-scrollbar-emerald"
      aria-live="polite"
      aria-label="Debate canvas"
    >
      {entries.length === 0 && !isStreaming && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Submit a case and start the debate to see logical reasoning, arguments, and
          bench scoring in the canvas.
        </div>
      )}

      {feed.map((item) => {
        if (item.type === "activity") {
          const live = isLiveActivity(item, entries, isStreaming);
          const argStarted = argumentStartedFor(item, entries);
          return (
            <ClashActivityBlock
              key={item.id}
              side={item.side}
              phase={item.phase}
              rag={
                item.rag
                  ? { id: item.rag.id, citations: item.rag.citations }
                  : null
              }
              reasoning={item.reasoning.map((r) => ({
                id: r.id,
                content: r.content,
                lawSections: r.lawSections,
                stepIndex: r.stepIndex,
              }))}
              live={live}
              argumentStarted={argStarted}
            />
          );
        }

        const entry = item.entry;
        if (entry.kind === "parameters") {
          return (
            <ClashParametersPanel key={entry.id} parameters={entry.parameters} />
          );
        }
        if (entry.kind === "stream") {
          return (
            <ClashMessageBubble
              key={entry.id}
              side={entry.side}
              phase={entry.phase}
              content={entry.content}
              streaming={!entry.finalized && isStreaming}
            />
          );
        }
        if (entry.kind === "question") {
          return (
            <ClashQuestionCard
              key={entry.id}
              side={entry.side}
              phase={entry.phase}
              questionId={entry.questionId}
              text={entry.text}
              quickReplies={entry.quickReplies}
              lawSections={entry.lawSections}
              questionTarget={entry.questionTarget}
              userAction={entry.userAction}
              aiAssistAllowed={entry.aiAssistAllowed}
              answered={entry.answered}
              onSubmit={onSubmitAnswer}
              disabled={isStreaming}
            />
          );
        }
        if (entry.kind === "cross_answer") {
          const isPros = entry.side === "prosecution";
          return (
            <div
              key={entry.id}
              className={`mb-3 flex w-full ${isPros ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl border px-3 py-2.5 text-sm ${
                  isPros
                    ? "border-primary/30 bg-primary/5 text-foreground"
                    : "border-amber-200 bg-amber-50/90 text-amber-950"
                }`}
              >
                <span
                  className={`text-xs font-bold uppercase ${
                    isPros ? "text-primary" : "text-amber-800"
                  }`}
                >
                  {isPros ? "Prosecution (Complainant): " : "Defence (Accused): "}
                </span>
                {entry.text}
              </div>
            </div>
          );
        }
        if (entry.kind === "answer") {
          return (
            <div key={entry.id} className="mb-3 flex w-full justify-end">
              <div className="max-w-[80%] rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                <span className="font-bold text-primary">
                  {entry.label || "You"}:{" "}
                </span>
                {entry.text}
              </div>
            </div>
          );
        }
        if (entry.kind === "round_score") {
          return <ClashRoundScoreCard key={entry.id} scores={entry.scores} />;
        }
        if (entry.kind === "judge_verdict") {
          return (
            <ClashJudgmentCard
              key={entry.id}
              result={entry.result}
              streaming={entry.streaming}
              partialContent={entry.content}
            />
          );
        }
        if (entry.kind === "final") {
          const hasVerdict = entries.some((e) => e.kind === "judge_verdict");
          if (hasVerdict) return null;
          return (
            <ClashJudgmentCard
              key={entry.id}
              result={entry.result}
              streaming={false}
            />
          );
        }
        if (entry.kind === "system") {
          return (
            <p
              key={entry.id}
              className="my-1.5 text-center text-[10px] text-muted-foreground"
            >
              {entry.content}
            </p>
          );
        }
        return null;
      })}

      {pendingQuestion &&
        !entries.some(
          (e) => e.kind === "question" && e.questionId === pendingQuestion.questionId
        ) && (
          <ClashQuestionCard
            side={pendingQuestion.side}
            phase={pendingQuestion.phase}
            questionId={pendingQuestion.questionId}
            text={pendingQuestion.text}
            lawSections={pendingQuestion.lawSections}
            questionTarget="user"
            userAction={pendingQuestion.userAction}
            aiAssistAllowed={pendingQuestion.aiAssistAllowed}
            onSubmit={onSubmitAnswer}
            disabled={isStreaming}
          />
        )}

      <div ref={bottomRef} />
    </div>
  );
}
