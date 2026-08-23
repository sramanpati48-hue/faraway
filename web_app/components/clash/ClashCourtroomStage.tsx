"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, X } from "lucide-react";
import type { ClashEntry } from "@/hooks/useClashStream";
import type { AgentSide, UserAction, UserRole } from "@/lib/clashApi";
import {
  entriesToArchiveItems,
  entriesToDebateTurns,
  speakerColumn,
  type DebateTurn,
} from "@/lib/clash/debateTurns";
import { ClashCourtroomBubble } from "@/components/clash/ClashCourtroomBubble";
import { ClashQuestionCard } from "@/components/clash/ClashQuestionCard";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/lib/motion";

type ClashCourtroomStageProps = {
  entries: ClashEntry[];
  userRole: UserRole;
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
};

type ColumnSide = "left" | "right" | "center";

/** Fluid portrait boxes — scale with viewport height/width, clamped for phones & large screens */
const LAWYER_PORTRAIT =
  "relative h-[clamp(5rem,15vh,10rem)] w-[clamp(8.5rem,22vw,14rem)]";
const JUDGE_PORTRAIT =
  "relative h-[clamp(5.5rem,17vh,11rem)] w-[clamp(9rem,26vw,17rem)]";
const ROLE_LABEL =
  "text-[clamp(0.625rem,1.7vw,0.75rem)] font-bold uppercase tracking-[0.14em]";

function latestTurnForColumn(
  turns: DebateTurn[],
  column: ColumnSide,
  userRole: UserRole
): DebateTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (speakerColumn(turns[i].speaker, userRole) === column) {
      return turns[i];
    }
  }
  return null;
}

function CharacterPod({
  imageSrc,
  label,
  align,
}: {
  imageSrc: string;
  label: string;
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-0.5",
        align === "left" ? "items-start" : "items-end"
      )}
    >
      <div className={LAWYER_PORTRAIT}>
        <Image
          src={imageSrc}
          alt=""
          fill
          className={cn(
            "object-contain object-bottom drop-shadow-lg",
            align === "right" && "scale-x-[-1]"
          )}
          sizes="(max-width: 640px) 38vw, (max-width: 1024px) 24vw, 224px"
          priority
        />
      </div>
      <p
        className={cn(
          ROLE_LABEL,
          "text-[#00634B] dark:text-emerald-300",
          align === "left" ? "text-left" : "text-right"
        )}
      >
        {label}
      </p>
    </div>
  );
}

function CounselSlot({
  align,
  turn,
  userRole,
  userQuestion,
  onSubmitAnswer,
  isStreaming,
}: {
  align: "left" | "right";
  turn: DebateTurn | null;
  userRole: UserRole;
  userQuestion: Extract<ClashEntry, { kind: "question" }> | null;
  onSubmitAnswer: ClashCourtroomStageProps["onSubmitAnswer"];
  isStreaming: boolean;
}) {
  const showQuestion = Boolean(userQuestion);

  return (
    <div
      className={cn(
        "flex w-full max-w-[min(48vw,clamp(16rem,42vw,22rem))] flex-col gap-[clamp(0.25rem,0.8vh,0.5rem)]",
        align === "left" ? "items-start" : "items-end"
      )}
    >
      {showQuestion ? (
        <motion.div
          key={userQuestion!.questionId}
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.97 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="w-full mt-4"
        >
          <ClashQuestionCard
            variant="stage"
            side={userQuestion!.side}
            phase={userQuestion!.phase}
            questionId={userQuestion!.questionId}
            text={userQuestion!.text}
            lawSections={userQuestion!.lawSections}
            questionTarget={userQuestion!.questionTarget}
            userAction={userQuestion!.userAction}
            aiAssistAllowed={userQuestion!.aiAssistAllowed}
            answered={userQuestion!.answered}
            onSubmit={onSubmitAnswer}
            disabled={isStreaming}
          />
        </motion.div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {turn && (
            <ClashCourtroomBubble
              key={turn.id}
              turn={turn}
              userRole={userRole}
              className="w-full mt-4"
            />
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

export function ClashCourtroomStage({
  entries,
  userRole,
  isStreaming,
  pendingQuestion: _pendingQuestion,
  onSubmitAnswer,
}: ClashCourtroomStageProps) {
  const [archiveOpen, setArchiveOpen] = useState(false);

  const turns = useMemo(() => entriesToDebateTurns(entries), [entries]);
  const archiveItems = useMemo(() => entriesToArchiveItems(entries), [entries]);

  const leftTurn = useMemo(
    () => latestTurnForColumn(turns, "left", userRole),
    [turns, userRole]
  );
  const rightTurn = useMemo(
    () => latestTurnForColumn(turns, "right", userRole),
    [turns, userRole]
  );
  const judgeTurn = useMemo(
    () => latestTurnForColumn(turns, "center", userRole),
    [turns, userRole]
  );

  const activeUserQuestion = useMemo(() => {
    return (
      entries.find(
        (
          entry
        ): entry is Extract<ClashEntry, { kind: "question" }> =>
          entry.kind === "question" &&
          !entry.answered &&
          (entry.questionTarget === "user" || Boolean(entry.userAction))
      ) ?? null
    );
  }, [entries]);

  const userLabel =
    userRole === "prosecution" ? "YOU | Prosecutor" : "YOU | Defender";
  const aiLabel =
    userRole === "prosecution" ? "AI | Defender" : "AI | Prosecutor";

  const userColumn: "left" | "right" =
    userRole === "prosecution" ? "left" : "right";
  const aiColumn: "left" | "right" =
    userRole === "prosecution" ? "right" : "left";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-100/80 to-[#F8F9FA] dark:from-slate-950 dark:to-slate-900">
      <button
        type="button"
        onClick={() => setArchiveOpen(true)}
        className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 px-3 py-2 text-xs font-semibold text-[#00634B] shadow-md backdrop-blur-sm transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/95 dark:text-emerald-300"
        aria-label="Open debate transcript archive"
      >
        <Archive className="size-4" />
        <span className="hidden sm:inline">Transcript</span>
        {archiveItems.length > 0 && (
          <span className="rounded-full bg-[#00634B] px-1.5 py-0.5 text-[10px] font-bold text-white dark:bg-emerald-600">
            {archiveItems.length}
          </span>
        )}
      </button>

      {/* Courtroom — flex column fills viewport; judge top, counsel bottom */}
      <div className="flex min-h-0 flex-1 flex-col justify-between px-2 pb-[clamp(0.375rem,1.2vh,0.75rem)] pt-11 sm:px-4 sm:pt-12">
        <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-col items-center">
          <div className={JUDGE_PORTRAIT}>
            <Image
              src="/clash/judge.png"
              alt=""
              fill
              className="object-contain object-bottom drop-shadow-xl"
              sizes="(max-width: 640px) 42vw, (max-width: 1024px) 28vw, 272px"
              priority
            />
          </div>
          <p className="mt-0.5 text-[clamp(0.625rem,1.6vw,0.75rem)] font-bold uppercase tracking-[0.18em] text-amber-900/90 dark:text-amber-200">
            Judge
          </p>
          <div className="mt-1 w-full max-h-[min(22vh,10rem)] overflow-y-auto px-1 custom-scrollbar-emerald sm:max-h-[min(26vh,12rem)]">
            <AnimatePresence mode="wait" initial={false}>
              {judgeTurn && (
                <ClashCourtroomBubble
                  key={judgeTurn.id}
                  turn={judgeTurn}
                  userRole={userRole}
                  wide
                  className="w-full mb-4"
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex shrink-0 items-end justify-between gap-2 px-[clamp(0.375rem,1.5vw,1rem)]">
          <div className="flex max-w-[min(48vw,clamp(16rem,42vw,22rem))] flex-col gap-[clamp(0.25rem,0.8vh,0.5rem)] items-start">
            <CounselSlot
              align="left"
              turn={leftTurn}
              userRole={userRole}
              userQuestion={userColumn === "left" ? activeUserQuestion : null}
              onSubmitAnswer={onSubmitAnswer}
              isStreaming={isStreaming}
            />
            <CharacterPod
              imageSrc="/clash/lawyer.png"
              label={aiColumn === "left" ? aiLabel : userLabel}
              align="left"
            />
          </div>

          <div className="flex max-w-[min(48vw,clamp(16rem,42vw,22rem))] flex-col gap-[clamp(0.25rem,0.8vh,0.5rem)] items-end">
            <CounselSlot
              align="right"
              turn={rightTurn}
              userRole={userRole}
              userQuestion={userColumn === "right" ? activeUserQuestion : null}
              onSubmitAnswer={onSubmitAnswer}
              isStreaming={isStreaming}
            />
            <CharacterPod
              imageSrc="/clash/lawyer.png"
              label={userColumn === "right" ? userLabel : aiLabel}
              align="right"
            />
          </div>
        </div>
      </div>

      {turns.length === 0 && isStreaming && !activeUserQuestion && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Opening statements…
        </div>
      )}

      <AnimatePresence>
        {archiveOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Close transcript"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setArchiveOpen(false)}
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
              className="absolute bottom-0 right-0 top-0 z-40 flex w-[min(100%,22rem)] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Debate transcript</h2>
                  <p className="text-xs text-muted-foreground">Full record of counsel and bench</p>
                </div>
                <button
                  type="button"
                  onClick={() => setArchiveOpen(false)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-900"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar-emerald">
                {archiveItems.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Transcript fills as the debate progresses.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {archiveItems.map((item) =>
                      item.kind === "turn" ? (
                        <li key={item.id}>
                          <ClashCourtroomBubble
                            turn={item.turn}
                            userRole={userRole}
                            layout={false}
                          />
                        </li>
                      ) : (
                        <li
                          key={item.id}
                          className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/50"
                        >
                          <p className="mb-1 font-bold uppercase tracking-wide text-[#00634B] dark:text-emerald-300">
                            {item.label}
                          </p>
                          <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                            {item.content}
                          </p>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
