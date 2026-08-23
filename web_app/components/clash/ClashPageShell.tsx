"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Swords, Loader2, Play, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { ClashMode, ClashMockCase, UserRole } from "@/lib/clashApi";
import {
  attachClashCase,
  createClashSession,
  fetchMockCases,
} from "@/lib/clashApi";
import {
  fetchClashBillingStatus,
  isClashQuotaError,
  type ClashBillingStatus,
} from "@/lib/clashBillingApi";
import { useClashStream } from "@/hooks/useClashStream";
import { ClashModeSelector } from "./ClashModeSelector";
import { ClashRoleSelector } from "./ClashRoleSelector";
import { MockCasePicker } from "./MockCasePicker";
import { CaseInputForm } from "./CaseInputForm";
import { ClashCourtroomStage } from "./ClashCourtroomStage";
import { ClashBenchSidebar } from "./ClashBenchSidebar";
import { ClashPricingModal } from "./ClashPricingModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

type Step = "setup" | "debate";

export function ClashPageShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const initialMode =
    (searchParams.get("mode") as ClashMode) === "real_life" ? "real_life" : "practice";
  const initialRole =
    (searchParams.get("role") as UserRole) === "defence" ? "defence" : "prosecution";

  const [mode, setMode] = useState<ClashMode>(initialMode);
  const [userRole, setUserRole] = useState<UserRole>(initialRole);
  const [step, setStep] = useState<Step>("setup");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mockCases, setMockCases] = useState<ClashMockCase[]>([]);
  const [selectedMock, setSelectedMock] = useState<ClashMockCase | null>(null);
  const [title, setTitle] = useState("");
  const [facts, setFacts] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const debateStartedRef = useRef(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [billing, setBilling] = useState<ClashBillingStatus | null>(null);
  const [awaitingPayment, setAwaitingPayment] = useState(false);

  const {
    entries,
    isStreaming,
    error,
    currentPhase,
    roundScores,
    finalResult,
    pendingQuestion,
    startDebate,
    submitAnswer,
    resetTranscript,
  } = useClashStream(sessionId, mode, userRole);

  const canvasEntries = entries;

  const refreshBilling = useCallback(async (): Promise<ClashBillingStatus | null> => {
    if (!accessToken) {
      setBilling(null);
      return null;
    }
    try {
      const status = await fetchClashBillingStatus();
      setBilling(status);
      if (status.plan_id !== "free" && status.status === "active") {
        setAwaitingPayment(false);
      }
      return status;
    } catch {
      return null;
    }
  }, [accessToken]);

  useEffect(() => {
    fetchMockCases().then(setMockCases).catch(console.error);
  }, []);

  useEffect(() => {
    void refreshBilling();
  }, [refreshBilling]);

  useEffect(() => {
    if (!accessToken) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshBilling();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [accessToken, refreshBilling]);

  useEffect(() => {
    if (!awaitingPayment || !accessToken) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 4 * 60 * 1000;
    const tick = async () => {
      const status = await refreshBilling();
      if (cancelled) return;
      if (status && status.plan_id !== "free" && status.status === "active") {
        setAwaitingPayment(false);
        return;
      }
      if (Date.now() < deadline) {
        timer = setTimeout(() => void tick(), 3000);
      } else {
        setAwaitingPayment(false);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [awaitingPayment, accessToken, refreshBilling]);

  useEffect(() => {
    const m = searchParams.get("mode");
    if (m === "practice" || m === "real_life") setMode(m);
    const r = searchParams.get("role");
    if (r === "prosecution" || r === "defence") setUserRole(r);
  }, [searchParams]);

  const syncUrl = (m: ClashMode, role: UserRole) => {
    router.replace(`/clash?mode=${m}&role=${role}`, { scroll: false });
  };

  const onModeChange = (m: ClashMode) => {
    setMode(m);
    syncUrl(m, userRole);
  };

  const onRoleChange = (r: UserRole) => {
    setUserRole(r);
    syncUrl(mode, r);
  };

  const handleSelectMock = (c: ClashMockCase) => {
    setSelectedMock(c);
    setTitle(c.title);
    setFacts(c.facts);
  };

  const handleStart = useCallback(async () => {
    setPrepareError(null);
    setIsPreparing(true);
    try {
      const t = title.trim() || selectedMock?.title || "Untitled Matter";
      const f = facts.trim() || selectedMock?.facts || "";
      if (f.length < 10) {
        setPrepareError(
          "Please provide at least a short description of the case facts."
        );
        setIsPreparing(false);
        return;
      }

      if (billing && !billing.can_start) {
        setPricingOpen(true);
        setPrepareError(
          billing.limit != null
            ? `You've used ${billing.used}/${billing.limit} Clash sessions this month. Upgrade to continue.`
            : "Clash quota reached. Upgrade to continue."
        );
        setIsPreparing(false);
        return;
      }

      const session = await createClashSession(mode, user?.uid, userRole);
      await attachClashCase(session.session_id, {
        title: t,
        facts: f,
        mock_case_id: selectedMock?.id,
      });
      setSessionId(session.session_id);
      resetTranscript();
      setStep("debate");
      setIsPreparing(false);
      void refreshBilling();
    } catch (e) {
      if (isClashQuotaError(e)) {
        setPricingOpen(true);
        const d = e.detail;
        setPrepareError(
          (typeof d === "object" && d && "message" in d && String(d.message)) ||
            "Clash quota reached this month. Upgrade to continue."
        );
      } else {
        setPrepareError(e instanceof Error ? e.message : "Failed to start");
      }
      setIsPreparing(false);
    }
  }, [
    title,
    facts,
    selectedMock,
    mode,
    userRole,
    user?.uid,
    resetTranscript,
    billing,
    refreshBilling,
  ]);

  useEffect(() => {
    if (
      step === "debate" &&
      sessionId &&
      !debateStartedRef.current &&
      !isStreaming &&
      !finalResult
    ) {
      debateStartedRef.current = true;
      startDebate();
    }
  }, [step, sessionId, isStreaming, finalResult, startDebate]);

  useEffect(() => {
    if (step === "setup") debateStartedRef.current = false;
  }, [step]);

  const roleLabel = userRole === "defence" ? "Defence" : "Prosecutor";
  const usageHint =
    billing && billing.limit != null
      ? `${Math.max(0, billing.remaining ?? billing.limit - billing.used)} left this month`
      : billing?.plan_id === "fearless"
        ? "Unlimited"
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Swords className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Clash Mode
              </h1>
              <p className="text-sm text-muted-foreground">
                {mode === "practice" ? "Practice" : "Real Life"} · {roleLabel} · live debate
                {usageHint ? ` · ${usageHint}` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {step === "setup" ? (
              <ClashModeSelector mode={mode} onChange={onModeChange} />
            ) : (
              <>
                <Badge variant="outline" className="w-fit capitalize">
                  You: {roleLabel}
                </Badge>
                {currentPhase && (
                  <Badge variant="secondary" className="w-fit capitalize">
                    {currentPhase.replace(/_/g, " ")}
                  </Badge>
                )}
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="hidden border-[#00634B]/30 text-[#00634B] hover:bg-[#00634B]/8 sm:inline-flex"
              onClick={() => setPricingOpen(true)}
            >
              <Sparkles className="size-3.5" aria-hidden />
              {billing && billing.plan_id !== "free" ? "Plan" : "Upgrade"}
            </Button>
          </div>
        </div>
      </header>

      {awaitingPayment && billing?.status !== "active" && (
        <div className="flex items-center justify-center gap-2 border-b border-[#00634B]/15 bg-[#00634B]/8 px-4 py-2 text-xs text-[#00634B]">
          <Loader2 className="size-3.5 animate-spin" />
          Confirming payment with Razorpay. You can leave this page — your plan updates when UPI or card completes.
        </div>
      )}

      <button
        type="button"
        onClick={() => setPricingOpen(true)}
        className="fixed right-4 z-40 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#00A07A] to-[#00634B] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_-6px_rgba(0,99,75,0.5)] transition-transform duration-150 ease-out active:scale-[0.96] sm:hidden"
        style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
      >
        <Sparkles className="size-4" aria-hidden />
        {billing && billing.plan_id !== "free" ? "Plan" : "Upgrade"}
      </button>

      {step === "setup" ? (
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar-emerald">
          <div className="mx-auto w-full max-w-2xl space-y-6 p-4 pb-8 sm:p-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {mode === "practice" ? "Practice courtroom" : "Your case"}
                </CardTitle>
                <CardDescription>
                  {mode === "practice"
                    ? "Pick a side, then a mock case or write your own. You argue your role (or let AI counsel help). The judge hears both sides across rounds and delivers a bench ruling."
                    : "Choose your side. Your AI lawyer argues for you; you answer factual questions from either counsel. The judge scores and gives a mock verdict."}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Your role</CardTitle>
                <CardDescription>
                  {mode === "practice"
                    ? "You will play this side yourself each turn (with optional AI assist)."
                    : "Your AI counsel will represent this side; you supply facts when asked."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ClashRoleSelector role={userRole} onChange={onRoleChange} />
              </CardContent>
            </Card>

            {mode === "practice" && mockCases.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-medium text-foreground">Mock cases</h2>
                <MockCasePicker
                  cases={mockCases}
                  selectedId={selectedMock?.id}
                  onSelect={handleSelectMock}
                />
              </section>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Case details</CardTitle>
              </CardHeader>
              <CardContent>
                <CaseInputForm
                  title={title}
                  facts={facts}
                  onTitleChange={setTitle}
                  onFactsChange={setFacts}
                  mode={mode}
                />
              </CardContent>
            </Card>

            {prepareError && (
              <Alert variant="destructive">
                <AlertDescription>{prepareError}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                size="lg"
                onClick={handleStart}
                disabled={isPreparing}
                className="sm:min-w-[180px]"
              >
                {isPreparing ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Play aria-hidden />
                )}
                Begin Debate
              </Button>
              <p className="text-xs text-muted-foreground">
                Simulation only — not legal advice. Agents cite Indian law via RAG.{" "}
                <button
                  type="button"
                  className="font-medium text-[#00634B] underline-offset-2 hover:underline"
                  onClick={() => setPricingOpen(true)}
                >
                  See plans
                </button>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ClashCourtroomStage
              entries={canvasEntries}
              userRole={userRole}
              isStreaming={isStreaming}
              pendingQuestion={pendingQuestion}
              onSubmitAnswer={submitAnswer}
            />
            <Separator />
            <div className="flex shrink-0 items-center justify-between gap-3 bg-card px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                {isStreaming && (
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-primary"
                    aria-hidden
                  />
                )}
                <span className="truncate">
                  {error ||
                    (isStreaming
                      ? "Live debate…"
                      : finalResult
                        ? "Debate complete"
                        : "Ready")}
                </span>
              </div>
              {finalResult && !isStreaming && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("setup");
                    setSessionId(null);
                    resetTranscript();
                  }}
                >
                  New debate
                </Button>
              )}
            </div>
          </div>
          <ClashBenchSidebar
            roundScores={roundScores}
            finalResult={finalResult}
            mode={mode}
            isStreaming={isStreaming}
          />
        </div>
      )}

      <ClashPricingModal
        open={pricingOpen}
        confirmingPayment={awaitingPayment}
        onCheckoutOpened={() => setAwaitingPayment(true)}
        onClose={() => {
          setPricingOpen(false);
          void refreshBilling();
        }}
        status={billing}
        onStatusChange={(next) => {
          setBilling(next);
          if (next.plan_id !== "free" && next.status === "active") {
            setAwaitingPayment(false);
          }
        }}
      />
    </div>
  );
}
