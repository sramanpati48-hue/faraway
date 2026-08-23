"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AgentSide, UserAction } from "@/lib/clashApi";
import { HelpCircle, Send, MessageSquare, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function ClashQuestionCard({
  side,
  phase,
  questionId,
  text,
  quickReplies = [],
  lawSections = [],
  questionTarget = "user",
  userAction = "answer",
  aiAssistAllowed = false,
  answered,
  onSubmit,
  disabled,
  variant = "transcript",
}: {
  side: AgentSide;
  phase?: string;
  questionId: string;
  text: string;
  quickReplies?: string[];
  lawSections?: string[];
  questionTarget?: "user" | "prosecution" | "defence";
  userAction?: UserAction;
  aiAssistAllowed?: boolean;
  answered?: boolean;
  onSubmit: (
    questionId: string,
    answer: string,
    options?: { delegate?: boolean }
  ) => void;
  disabled?: boolean;
  variant?: "stage" | "transcript";
}) {
  const [answer, setAnswer] = useState("");
  const isProsecution = side === "prosecution";
  const needsUserInput = questionTarget === "user" || Boolean(userAction);
  const awaitingAi =
    !needsUserInput &&
    (questionTarget === "defence" || questionTarget === "prosecution");
  const isStage = variant === "stage";

  const actionLabel =
    userAction === "argue"
      ? "Your argument"
      : userAction === "ask"
        ? "Your cross-examination question"
        : "Your answer";

  const placeholder =
    userAction === "argue"
      ? "Type your courtroom submission…"
      : userAction === "ask"
        ? "Ask one specific question to the opposing party…"
        : "Answer with facts for the Court…";

  const headerLabel =
    userAction === "argue"
      ? "Your turn — present your case"
      : userAction === "ask"
        ? side === "prosecution"
          ? "Prosecution → cross-examine Defence"
          : side === "defence"
            ? "Defence → cross-examine Prosecution"
            : "Ask a cross-examination question"
        : isProsecution
          ? "Question for you"
          : side === "defence"
            ? "Question for you"
            : "Court needs your input";

  if (answered) {
    return null;
  }

  const cardSurface = isStage
    ? "w-full border-[#00634B]/25 bg-[#00634B]/5 dark:border-emerald-800/40 dark:bg-emerald-950/25"
    : userAction === "argue"
      ? "w-full border-primary/30 bg-primary/5 sm:max-w-[90%]"
      : isProsecution
        ? "border-primary/25 bg-primary/5"
        : "border-amber-300/40 bg-amber-50/80 dark:border-amber-800/40 dark:bg-amber-950/20";

  return (
    <div
      className={cn(
        "flex w-full",
        isStage
          ? "justify-start"
          : cn(
              "mb-5",
              needsUserInput ? "justify-center" : isProsecution ? "justify-end" : "justify-start"
            )
      )}
      role="region"
      aria-label={headerLabel}
    >
      <div
        className={cn(
          "min-w-0 rounded-2xl border p-4 shadow-md",
          isStage ? "max-w-none" : "max-w-[92%] sm:max-w-[78%]",
          cardSurface
        )}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <HelpCircle
            className={cn(
              "size-4",
              isProsecution || userAction === "argue"
                ? "text-primary"
                : "text-amber-600"
            )}
            aria-hidden
          />
          <span className="text-xs font-bold uppercase text-muted-foreground">
            {headerLabel}
          </span>
          {phase && (
            <Badge variant="outline" className="text-[10px] capitalize">
              {phase.replace(/_/g, " ")}
            </Badge>
          )}
          {userAction && needsUserInput && (
            <Badge variant="secondary" className="text-[10px] capitalize">
              {userAction}
            </Badge>
          )}
        </div>

        {lawSections.length > 0 && (
          <div className="mb-2 flex min-w-0 flex-col gap-1.5">
            {lawSections.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="h-auto max-w-full min-w-0 shrink whitespace-normal break-words rounded-lg px-2.5 py-1.5 text-left text-[10px] leading-snug font-normal"
              >
                {s}
              </Badge>
            ))}
          </div>
        )}

        <p className="mb-3 text-sm font-medium break-words whitespace-pre-wrap text-foreground">
          {text}
        </p>

        {awaitingAi ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground italic">
            <MessageSquare className="size-3.5 shrink-0" aria-hidden />
            Awaiting opposing counsel&apos;s response…
          </p>
        ) : needsUserInput ? (
          <>
            {quickReplies.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {quickReplies.map((q) => (
                  <Button
                    key={q}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onSubmit(questionId, q)}
                    disabled={disabled}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {userAction === "argue" ? (
                <Textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={placeholder}
                  aria-label={actionLabel}
                  disabled={disabled}
                  rows={isStage ? 3 : 4}
                  className="text-sm"
                />
              ) : (
                <Input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={placeholder}
                  aria-label={actionLabel}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && answer.trim()) {
                      onSubmit(questionId, answer.trim());
                      setAnswer("");
                    }
                  }}
                  disabled={disabled}
                  className="text-sm"
                />
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    if (answer.trim()) {
                      onSubmit(questionId, answer.trim());
                      setAnswer("");
                    }
                  }}
                  disabled={disabled || !answer.trim()}
                  className="gap-2"
                >
                  <Send className="size-4" />
                  {userAction === "argue"
                    ? "Submit argument"
                    : userAction === "ask"
                      ? "Ask question"
                      : "Submit answer"}
                </Button>
                {aiAssistAllowed && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onSubmit(questionId, "", { delegate: true })}
                    disabled={disabled}
                    className="gap-2"
                  >
                    <Sparkles className="size-4" />
                    Let my counsel handle this
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
