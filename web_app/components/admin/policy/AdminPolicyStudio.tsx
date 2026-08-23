"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, PanelRightClose, PanelRightOpen, Undo2 } from "lucide-react";
import { AdminTabHeaderBar } from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  adminBtnPrimary,
  adminBtnSecondary,
} from "@/components/admin/admin-ui";
import { PolicyComposer } from "@/components/admin/policy/PolicyComposer";
import { PolicyImpactPanel } from "@/components/admin/policy/PolicyImpactPanel";
import { PolicyImplementDialog } from "@/components/admin/policy/PolicyImplementDialog";
import { PolicyQuestionFlow } from "@/components/admin/policy/PolicyQuestionFlow";
import { impactPrompt, questionPrompt } from "@/components/admin/policy/policy-genui-library";
import {
  adminApi,
  type PolicyChangeSet,
  type PolicyContextRef,
  type PolicyDocument,
  type PolicyStreamEvent,
} from "@/lib/adminApi";

const PANEL_KEY = "nyaya_admin_policy_panel_open";

const RISK_BADGE: Record<string, string> = {
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  high: "border-red-500/30 bg-red-500/10 text-red-300",
};

export function AdminPolicyStudio() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [attached, setAttached] = useState<PolicyContextRef[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [plan, setPlan] = useState<PolicyChangeSet | null>(null);
  const [questionsUi, setQuestionsUi] = useState("");
  const [impactUi, setImpactUi] = useState("");
  const [policy, setPolicy] = useState<PolicyDocument | null>(null);
  const [history, setHistory] = useState<PolicyDocument[]>([]);

  const [panelOpen, setPanelOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [implementing, setImplementing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(PANEL_KEY) : null;
    if (stored !== null) setPanelOpen(stored === "1");
    else if (typeof window !== "undefined") setPanelOpen(window.innerWidth >= 1280);
  }, []);

  const togglePanel = () => {
    setPanelOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem(PANEL_KEY, next ? "1" : "0");
      return next;
    });
  };

  const loadHistory = useCallback(async () => {
    try {
      const res = await adminApi.policyList(25);
      setHistory(res.policies || []);
    } catch {
      // History is supplementary; a failure here should not block drafting.
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const runStream = useCallback(
    async (nextAnswers: Record<string, string>, keepQuestions: boolean) => {
      if (!description.trim()) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setError(null);
      setNotice(null);
      setStage("Starting…");
      if (!keepQuestions) setQuestionsUi("");
      setImpactUi("");

      try {
        await adminApi.policyDraftStream(
          {
            description,
            title,
            policy_id: policy?.status === "draft" ? policy.id : null,
            context_refs: attached,
            answers: nextAnswers,
            genui_prompt: questionPrompt(),
            impact_prompt: impactPrompt(),
            period_days: 30,
          },
          (event: PolicyStreamEvent) => {
            switch (event.type) {
              case "stage":
                setStage(event.label);
                break;
              case "context":
                setAttached(event.context || []);
                break;
              case "plan":
                setPlan(event.plan);
                if (!event.plan.open_questions?.length) setQuestionsUi("");
                break;
              case "questions_ui":
                setQuestionsUi(event.content);
                break;
              case "impact_ui":
                setImpactUi(event.content);
                setPanelOpen(true);
                break;
              case "saved":
                setPolicy(event.policy);
                if (!title && event.policy.title) setTitle(event.policy.title);
                break;
              case "done":
                setStage(null);
                break;
              case "error":
                setError(event.message);
                break;
            }
          },
          controller.signal
        );
        await loadHistory();
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setError(err instanceof Error ? err.message : "The policy studio run failed");
        }
      } finally {
        setRunning(false);
        setStage(null);
        abortRef.current = null;
      }
    },
    [attached, description, loadHistory, policy, title]
  );

  const handleSubmitAnswers = useCallback(
    (submitted: Record<string, string>) => {
      const merged = { ...answers, ...submitted };
      setAnswers(merged);
      void runStream(merged, true);
    },
    [answers, runStream]
  );

  async function implement(confirm: string) {
    if (!policy) return;
    setImplementing(true);
    try {
      const res = await adminApi.policyImplement(policy.id, confirm);
      setPolicy(res.policy);
      setDialogOpen(false);
      setNotice(
        `Policy activated. ${res.applied.length} config value${
          res.applied.length === 1 ? "" : "s"
        } written${res.skipped.length ? `, ${res.skipped.length} left as manual follow-ups` : ""}.`
      );
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Implementation failed");
    } finally {
      setImplementing(false);
    }
  }

  async function rollback(target: PolicyDocument) {
    setImplementing(true);
    try {
      const res = await adminApi.policyRollback(target.id);
      if (policy?.id === target.id) setPolicy(res.policy);
      setNotice(
        res.restored.length
          ? `Rolled back. Restored ${res.restored.join(", ")}.`
          : "Rolled back. The policy text is no longer injected."
      );
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setImplementing(false);
    }
  }

  function loadPolicy(doc: PolicyDocument) {
    setPolicy(doc);
    setTitle(doc.title);
    setDescription(doc.description);
    setAttached(doc.context_refs || []);
    setAnswers(doc.answers || {});
    setPlan(doc.change_set || null);
    setQuestionsUi("");
    setImpactUi("");
    setNotice(null);
    setError(null);
  }

  function reset() {
    abortRef.current?.abort();
    setPolicy(null);
    setTitle("");
    setDescription("");
    setAttached([]);
    setAnswers({});
    setPlan(null);
    setQuestionsUi("");
    setImpactUi("");
    setNotice(null);
    setError(null);
  }

  const canImplement = !!policy && policy.status === "draft" && !!plan;
  const risk = String(plan?.risk || policy?.risk || "medium");
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AdminTabHeaderBar
        badge="Configuration"
        title="Improvise policies"
        description="Describe a change in plain language, answer what the studio asks, review the impact, then implement."
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className={`${adminBtnSecondary} text-xs`} onClick={reset}>
              New policy
            </button>
            <button
              type="button"
              className={`${adminBtnSecondary} gap-2 text-xs`}
              onClick={togglePanel}
              aria-label={panelOpen ? "Hide impact panel" : "Show impact panel"}
            >
              {panelOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
              Impact
            </button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="admin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top_left,rgba(30,30,40,0.35),transparent_50%)] px-5 py-5 md:px-6 md:py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
            {notice && (
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3 text-xs text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            <PolicyComposer
              title={title}
              description={description}
              attached={attached}
              running={running}
              stage={stage}
              onTitleChange={setTitle}
              onDescriptionChange={setDescription}
              onAttach={(ref) =>
                setAttached((prev) =>
                  prev.some((r) => r.kind === ref.kind && r.ref_id === ref.ref_id)
                    ? prev
                    : [...prev, ref]
                )
              }
              onDetach={(ref) =>
                setAttached((prev) =>
                  prev.filter((r) => !(r.kind === ref.kind && r.ref_id === ref.ref_id))
                )
              }
              onRun={() => void runStream(answers, false)}
              onStop={() => abortRef.current?.abort()}
              onError={setError}
            />

            {questionsUi || plan?.open_questions?.length ? (
              <PolicyQuestionFlow
                content={questionsUi}
                fallbackQuestions={plan?.open_questions}
                streaming={running}
                busy={running}
                onSubmitAnswers={handleSubmitAnswers}
              />
            ) : null}

            {plan ? (
              <section className="rounded-[20px] border border-white/[0.09] bg-[#0c0c0c] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-white/85">Proposed change set</h2>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      RISK_BADGE[risk] || RISK_BADGE.medium
                    }`}
                  >
                    {risk} risk
                  </span>
                </div>

                {plan.summary ? (
                  <p className="mt-2 text-xs leading-relaxed text-white/60">{plan.summary}</p>
                ) : null}

                {plan.open_questions?.length ? (
                  <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-200">
                    Waiting on {plan.open_questions.length} answer
                    {plan.open_questions.length === 1 ? "" : "s"} before this is ready to implement.
                    {answeredCount ? ` ${answeredCount} already provided.` : ""}
                  </p>
                ) : null}

                {plan.config_changes?.length ? (
                  <ul className="mt-3 flex flex-col gap-2">
                    {plan.config_changes.map((change, i) => (
                      <li
                        key={i}
                        className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2"
                      >
                        <p className="font-mono text-[11px] text-white/70">
                          {change.key}.{change.path}
                        </p>
                        <p className="mt-1 flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-red-300/80">{stringify(change.from)}</span>
                          <ChevronRight className="h-3 w-3 text-white/25" />
                          <span className="text-emerald-300/90">{stringify(change.to)}</span>
                        </p>
                        {change.reason ? (
                          <p className="mt-1 text-[11px] text-white/40">{change.reason}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[11px] text-white/35">
                    No automatic configuration changes — this activates policy text only.
                  </p>
                )}

                {plan.manual_followups?.length ? (
                  <div className="mt-4">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-white/40">
                      Manual follow-ups
                    </h3>
                    <ul className="mt-2 flex flex-col gap-2">
                      {plan.manual_followups.map((item, i) => (
                        <li
                          key={i}
                          className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2"
                        >
                          <p className="text-[11px] font-medium text-amber-200">{item.title}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-white/55">
                            {item.detail}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`${adminBtnPrimary} text-xs`}
                    disabled={!canImplement || running}
                    onClick={() => setDialogOpen(true)}
                  >
                    Review and implement
                  </button>
                  {policy?.status === "active" ? (
                    <button
                      type="button"
                      className={`${adminBtnSecondary} gap-2 text-xs`}
                      disabled={implementing}
                      onClick={() => void rollback(policy)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Roll back
                    </button>
                  ) : null}
                  {policy ? (
                    <span className="text-[11px] text-white/35">
                      {policy.status} · v{policy.version}
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {history.length > 0 ? (
              <section className="rounded-[20px] border border-white/[0.09] bg-[#0c0c0c] p-5">
                <h2 className="text-sm font-semibold text-white/85">Policy history</h2>
                <ul className="mt-3 flex flex-col gap-1">
                  {history.map((doc) => (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => loadPolicy(doc)}
                        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.04] ${
                          policy?.id === doc.id ? "bg-white/[0.05]" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs text-white/80">{doc.title}</span>
                          <span className="block truncate text-[11px] text-white/35">
                            {doc.description}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                            doc.status === "active"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-white/10 bg-white/[0.04] text-white/45"
                          }`}
                        >
                          {doc.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>

        {panelOpen ? (
          <aside className="admin-scrollbar hidden min-h-0 w-[420px] shrink-0 overflow-y-auto border-l border-white/[0.08] bg-[#050505] lg:block">
            <div className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#050505]/95 px-4 py-3 backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Impact analysis
              </h2>
            </div>
            <PolicyImpactPanel content={impactUi} streaming={running} stage={stage} />
          </aside>
        ) : null}
      </div>

      {dialogOpen && policy ? (
        <PolicyImplementDialog
          policy={{ ...policy, change_set: plan || policy.change_set }}
          busy={implementing}
          onClose={() => setDialogOpen(false)}
          onConfirm={(confirm) => void implement(confirm)}
        />
      ) : null}
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
