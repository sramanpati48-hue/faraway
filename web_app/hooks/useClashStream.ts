"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AgentSide,
  ClashMode,
  ClashStreamEvent,
  FinalClashResult,
  JudgeParameter,
  JudgeScore,
  ParameterScore,
  RagCitation,
  UserAction,
  UserRole,
} from "@/lib/clashApi";
import {
  sanitizeCounselDisplayText,
  streamClashAnswer,
  streamClashDebate,
} from "@/lib/clashApi";
import { useNdjsonStream } from "./useNdjsonStream";

export type ClashEntry =
  | {
      id: string;
      kind: "stream";
      side: AgentSide;
      phase?: string;
      content: string;
      finalized: boolean;
    }
  | {
      id: string;
      kind: "reasoning";
      side: AgentSide;
      phase?: string;
      content: string;
      lawSections?: string[];
      stepIndex?: number;
    }
  | {
      id: string;
      kind: "question";
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
    }
  | {
      id: string;
      kind: "answer";
      side: AgentSide;
      phase?: string;
      questionId: string;
      text: string;
      label?: string;
    }
  | {
      id: string;
      kind: "cross_answer";
      side: AgentSide;
      phase?: string;
      questionId: string;
      text: string;
    }
  | {
      id: string;
      kind: "rag";
      side: AgentSide;
      phase?: string;
      citations: RagCitation[];
    }
  | {
      id: string;
      kind: "round_score";
      phase?: string;
      scores: JudgeScore;
    }
  | {
      id: string;
      kind: "parameters";
      parameters: JudgeParameter[];
    }
  | {
      id: string;
      kind: "judge_verdict";
      content: string;
      streaming: boolean;
      result?: FinalClashResult;
    }
  | {
      id: string;
      kind: "system";
      content: string;
    }
  | {
      id: string;
      kind: "final";
      result: FinalClashResult;
    };

function uid() {
  return `e_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeJudgeScore(
  scores: Record<string, unknown>,
  phase?: string
): JudgeScore {
  const params = (scores.parameters as ParameterScore[]) || [];
  const normalized: JudgeScore = {
    phase: (scores.phase as string) || phase,
    legal_accuracy: Number(scores.legal_accuracy) || 0,
    coherence: Number(scores.coherence) || 0,
    evidence_usage: Number(scores.evidence_usage) || 0,
    procedural_soundness: Number(scores.procedural_soundness) || 0,
    phase_fulfillment: Number(scores.phase_fulfillment) || 0,
    round_total: Number(scores.round_total) || 0,
    bench_note: scores.bench_note as string | undefined,
    parameters: params,
    prosecution_average: Number(scores.prosecution_average) || 0,
    defence_average: Number(scores.defence_average) || 0,
    round_winner: (scores.round_winner as JudgeScore["round_winner"]) || "draw",
  };
  if (!Number.isFinite(normalized.round_total) || normalized.round_total <= 0) {
    normalized.round_total =
      (normalized.prosecution_average || 0) * (params.length || 5);
  }
  return normalized;
}

function normalizeFinalResult(raw: Record<string, unknown>): FinalClashResult {
  const w = String(raw.declared_winner || "draw").toLowerCase();
  const declared_winner =
    w === "prosecution" || w === "complainant"
      ? "prosecution"
      : w === "defence" || w === "defense" || w === "defendant"
        ? "defence"
        : "draw";
  return {
    overall_score: Number(raw.overall_score) || 0,
    confidence_band: String(raw.confidence_band || "medium"),
    mock_verdict: String(raw.mock_verdict || ""),
    declared_winner,
    winner_explanation: String(
      raw.winner_explanation || raw.mock_verdict || ""
    ),
    actionability_notes: String(raw.actionability_notes || ""),
    evidence_gaps: (raw.evidence_gaps as string[]) || [],
    unresolved_questions: (raw.unresolved_questions as string[]) || [],
    round_scores: raw.round_scores as JudgeScore[] | undefined,
    judge_parameters: raw.judge_parameters as JudgeParameter[] | undefined,
    parameter_totals: raw.parameter_totals as ParameterScore[] | undefined,
    prosecution_overall_average: Number(raw.prosecution_overall_average) || 0,
    defence_overall_average: Number(raw.defence_overall_average) || 0,
  };
}

export function useClashStream(
  sessionId: string | null,
  mode: ClashMode,
  userRole: UserRole = "prosecution"
) {
  const [entries, setEntries] = useState<ClashEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<string | undefined>();
  const [roundScores, setRoundScores] = useState<JudgeScore[]>([]);
  const [judgeParameters, setJudgeParameters] = useState<JudgeParameter[]>([]);
  const [finalResult, setFinalResult] = useState<FinalClashResult | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{
    questionId: string;
    text: string;
    side: AgentSide;
    phase?: string;
    lawSections?: string[];
    questionTarget: "user" | "prosecution" | "defence";
    userAction: UserAction;
    aiAssistAllowed: boolean;
  } | null>(null);

  const activeBubbleRef = useRef<{ side: AgentSide; id: string } | null>(null);
  const activeVerdictRef = useRef<string | null>(null);
  const { consumeStream } = useNdjsonStream();

  const upsertStreamToken = useCallback(
    (side: AgentSide, phase: string | undefined, token: string, finalize: boolean) => {
      setEntries((prev) => {
        const active = activeBubbleRef.current;
        if (active && active.side === side && !finalize) {
          return prev.map((e) =>
            e.kind === "stream" && e.id === active.id
              ? { ...e, content: e.content + token, phase: phase ?? e.phase }
              : e
          );
        }
        if (finalize && active && active.side === side) {
          activeBubbleRef.current = null;
          return prev.map((e) =>
            e.kind === "stream" && e.id === active.id
              ? {
                  ...e,
                  content: token.trim()
                    ? token
                    : sanitizeCounselDisplayText(e.content) || e.content,
                  finalized: true,
                  phase: phase ?? e.phase,
                }
              : e
          );
        }
        if (finalize) {
          for (let i = prev.length - 1; i >= 0; i--) {
            const e = prev[i];
            if (e.kind === "stream" && e.side === side && !e.finalized) {
              activeBubbleRef.current = null;
              return prev.map((entry, idx) =>
                idx === i && entry.kind === "stream"
                  ? {
                      ...entry,
                      content: token.trim()
                        ? token
                        : sanitizeCounselDisplayText(entry.content) || entry.content,
                      finalized: true,
                      phase: phase ?? entry.phase,
                    }
                  : entry
              );
            }
          }
          if (!token.trim()) return prev;
        }
        const id = uid();
        activeBubbleRef.current = finalize ? null : { side, id };
        return [
          ...prev,
          {
            id,
            kind: "stream" as const,
            side,
            phase,
            content: token,
            finalized: finalize,
          },
        ];
      });
    },
    []
  );

  const appendVerdictToken = useCallback((token: string, finalize: boolean, result?: FinalClashResult) => {
    setEntries((prev) => {
      const activeId = activeVerdictRef.current;
      if (activeId) {
        return prev.map((e) =>
          e.kind === "judge_verdict" && e.id === activeId
            ? {
                ...e,
                content: finalize ? token || e.content : e.content + token,
                streaming: !finalize,
                result: result ?? e.result,
              }
            : e
        );
      }
      const id = uid();
      activeVerdictRef.current = finalize ? null : id;
      return [
        ...prev,
        {
          id,
          kind: "judge_verdict" as const,
          content: token,
          streaming: !finalize,
          result,
        },
      ];
    });
    if (finalize) activeVerdictRef.current = null;
  }, []);

  const handleEvent = useCallback(
    (data: ClashStreamEvent) => {
      const phase = data.phase;
      if (phase) setCurrentPhase(phase);

      switch (data.event_type) {
        case "debate_started":
        case "phase_start":
          setEntries((prev) => [
            ...prev,
            { id: uid(), kind: "system", content: data.content || "Court in session…" },
          ]);
          break;

        case "parameters_announced": {
          const params = (data.payload?.parameters as JudgeParameter[]) || [];
          if (params.length) {
            setJudgeParameters(params);
            setEntries((prev) => [
              ...prev,
              { id: uid(), kind: "parameters", parameters: params },
            ]);
          }
          break;
        }

        case "rag_retrieved": {
          const citations = (data.payload?.citations as RagCitation[]) || [];
          if (citations.length) {
            setEntries((prev) => [
              ...prev,
              {
                id: uid(),
                kind: "rag",
                side: data.agent_side || "system",
                phase,
                citations,
              },
            ]);
          }
          break;
        }

        case "reasoning_step": {
          const side =
            data.agent_side === "defence" ? "defence" : "prosecution";
          setEntries((prev) => [
            ...prev,
            {
              id: uid(),
              kind: "reasoning",
              side,
              phase,
              content: data.content || "",
              lawSections: (data.payload?.law_sections as string[]) || [],
              stepIndex: Number(data.payload?.index) || 0,
            },
          ]);
          break;
        }

        case "stream_start":
          activeBubbleRef.current = null;
          break;

        case "stream_token":
          if (data.agent_side === "prosecution" || data.agent_side === "defence") {
            upsertStreamToken(data.agent_side, phase, data.content || "", false);
          }
          break;

        case "stream_end":
          if (data.agent_side === "prosecution" || data.agent_side === "defence") {
            upsertStreamToken(
              data.agent_side,
              phase,
              sanitizeCounselDisplayText(data.content || ""),
              true
            );
          }
          break;

        case "question_request": {
          const qid = (data.payload?.question_id as string) || uid();
          const side =
            data.agent_side === "defence"
              ? "defence"
              : data.agent_side === "prosecution"
                ? "prosecution"
                : "system";
          const lawSections = (data.payload?.law_sections as string[]) || [];
          const questionTarget =
            (data.payload?.question_target as "user" | "prosecution" | "defence") ||
            "user";
          const userAction =
            (data.payload?.user_action as UserAction) || "answer";
          const aiAssistAllowed = Boolean(data.payload?.ai_assist_allowed);
          const needsUser =
            questionTarget === "user" ||
            Boolean(data.payload?.user_action);

          if (needsUser && data.payload?.user_action) {
            setPendingQuestion({
              questionId: qid,
              text: data.content || "",
              side,
              phase,
              lawSections,
              questionTarget: "user",
              userAction,
              aiAssistAllowed,
            });
          } else if (questionTarget === "user") {
            setPendingQuestion({
              questionId: qid,
              text: data.content || "",
              side,
              phase,
              lawSections,
              questionTarget: "user",
              userAction,
              aiAssistAllowed,
            });
          } else {
            setPendingQuestion(null);
          }
          setEntries((prev) => [
            ...prev,
            {
              id: uid(),
              kind: "question",
              side,
              phase,
              questionId: qid,
              text: data.content || "",
              quickReplies: (data.payload?.quick_replies as string[]) || [],
              lawSections,
              questionTarget,
              userAction: needsUser ? userAction : undefined,
              aiAssistAllowed: needsUser ? aiAssistAllowed : false,
            },
          ]);
          activeBubbleRef.current = null;
          break;
        }

        case "cross_answer": {
          const qid = (data.payload?.question_id as string) || "";
          const side =
            data.agent_side === "prosecution" ? "prosecution" : "defence";
          const text = sanitizeCounselDisplayText(data.content || "");
          if (!text.trim()) break;
          setEntries((prev) => [
            ...prev.map((e) =>
              e.kind === "question" && e.questionId === qid
                ? { ...e, answered: true }
                : e
            ),
            {
              id: uid(),
              kind: "cross_answer",
              side,
              phase,
              questionId: qid,
              text,
            },
          ]);
          break;
        }

        case "user_answer_received": {
          const isDelegate = Boolean(data.payload?.delegate);
          const action = (data.payload?.user_action as UserAction) || "answer";
          const roleLabel =
            userRole === "defence" ? "You (Defence)" : "You (Prosecution)";
          setEntries((prev) => [
            ...prev,
            {
              id: uid(),
              kind: "answer",
              side: userRole,
              phase,
              questionId: (data.payload?.question_id as string) || "",
              text: isDelegate
                ? `Delegated to AI counsel (${action})`
                : data.content || "",
              label: roleLabel,
            },
          ]);
          setEntries((prev) =>
            prev.map((e) =>
              e.kind === "question" && e.questionId === data.payload?.question_id
                ? { ...e, answered: true }
                : e
            )
          );
          setPendingQuestion(null);
          break;
        }

        case "round_complete": {
          const raw = data.payload?.scores as Record<string, unknown> | JudgeScore;
          if (raw && typeof raw === "object") {
            const normalized = normalizeJudgeScore(
              raw as Record<string, unknown>,
              phase
            );
            setRoundScores((r) => [...r, normalized]);
            setEntries((prev) => [
              ...prev,
              { id: uid(), kind: "round_score", phase, scores: normalized },
            ]);
          }
          break;
        }

        case "judge_verdict_start": {
          const id = uid();
          activeVerdictRef.current = id;
          setEntries((prev) => [
            ...prev,
            { id, kind: "judge_verdict", content: "", streaming: true },
          ]);
          break;
        }

        case "judge_verdict_token":
          appendVerdictToken(data.content || "", false);
          break;

        case "judge_verdict_end":
          appendVerdictToken(data.content || "", true);
          break;

        case "final_result": {
          const raw = data.payload as Record<string, unknown>;
          if (raw && typeof raw === "object") {
            const result = normalizeFinalResult(raw);
            setFinalResult(result);
            setEntries((prev) => {
              const withVerdict = prev.map((e) =>
                e.kind === "judge_verdict"
                  ? {
                      ...e,
                      content: result.winner_explanation || e.content,
                      streaming: false,
                      result,
                    }
                  : e
              );
              const hasFinal = withVerdict.some((e) => e.kind === "final");
              if (hasFinal) return withVerdict;
              return [
                ...withVerdict,
                { id: uid(), kind: "final" as const, result },
              ];
            });
          }
          break;
        }

        case "error":
          setError(data.content || "Stream error");
          break;
        default:
          break;
      }
    },
    [upsertStreamToken, appendVerdictToken, userRole]
  );

  const runStream = useCallback(
    async (response: Response) => {
      setIsStreaming(true);
      setError(null);
      try {
        await consumeStream(response, (d) =>
          handleEvent(d as unknown as ClashStreamEvent)
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Stream failed");
      } finally {
        setIsStreaming(false);
        activeBubbleRef.current = null;
        activeVerdictRef.current = null;
      }
    },
    [consumeStream, handleEvent]
  );

  const startDebate = useCallback(async () => {
    if (!sessionId) return;
    setEntries([]);
    setRoundScores([]);
    setJudgeParameters([]);
    setFinalResult(null);
    setPendingQuestion(null);
    const res = await streamClashDebate(sessionId);
    await runStream(res);
  }, [sessionId, runStream]);

  const submitAnswer = useCallback(
    async (
      questionId: string,
      answer: string,
      options?: { delegate?: boolean }
    ) => {
      if (!sessionId) return;
      setPendingQuestion(null);
      const res = await streamClashAnswer(
        sessionId,
        questionId,
        answer,
        options
      );
      await runStream(res);
    },
    [sessionId, runStream]
  );

  const resetTranscript = useCallback(() => {
    setEntries([]);
    setRoundScores([]);
    setJudgeParameters([]);
    setFinalResult(null);
    setPendingQuestion(null);
    setError(null);
  }, []);

  return {
    entries,
    isStreaming,
    error,
    mode,
    userRole,
    currentPhase,
    roundScores,
    judgeParameters,
    finalResult,
    pendingQuestion,
    startDebate,
    submitAnswer,
    resetTranscript,
  };
}
