"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles, X, Zap } from "lucide-react";
import {
  cancelClashSubscription,
  fetchClashBillingPlans,
  openRazorpayCheckout,
  subscribeClashPlan,
  syncClashBilling,
  verifyClashOrderPayment,
  type ClashBillingStatus,
  type ClashPlan,
} from "@/lib/clashBillingApi";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onClose: () => void;
  status: ClashBillingStatus | null;
  onStatusChange: (next: ClashBillingStatus) => void;
  confirmingPayment?: boolean;
  onCheckoutOpened?: () => void;
};

function planIsActive(next: ClashBillingStatus, planId: string): boolean {
  return next.plan_id === planId && next.status === "active";
}

function formatInr(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

function limitLabel(limit: number | null | undefined): string {
  if (limit == null) return "Unlimited sessions / month";
  return `${limit} sessions / month`;
}

export function ClashPricingModal({
  open,
  onClose,
  status,
  onStatusChange,
  confirmingPayment = false,
  onCheckoutOpened,
}: Props) {
  const [plans, setPlans] = useState<ClashPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPlan, setConfirmingPlan] = useState<"basic" | "fearless" | null>(null);
  const pollStopRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    void fetchClashBillingPlans()
      .then(setPlans)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load plans"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) pollStopRef.current = true;
  }, [open]);

  if (!open) return null;

  const showingConfirm = confirmingPlan != null || confirmingPayment;

  const currentId = status?.plan_id || "free";

  const waitForPaidPlan = async (planId: "basic" | "fearless") => {
    pollStopRef.current = false;
    setConfirmingPlan(planId);
    const deadline = Date.now() + 4 * 60 * 1000;
    while (!pollStopRef.current && Date.now() < deadline) {
      try {
        const next = await syncClashBilling();
        if (planIsActive(next, planId)) {
          setConfirmingPlan(null);
          onStatusChange(next);
          onClose();
          return true;
        }
      } catch {
        /* Razorpay may still be settling UPI */
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!pollStopRef.current) {
      setConfirmingPlan(null);
      setError("If UPI or card payment completed, refresh this page — we confirm it automatically.");
    }
    return false;
  };

  const handleSubscribe = async (planId: "basic" | "fearless", planName: string) => {
    setError(null);
    setBusyPlan(planId);
    try {
      const checkout = await subscribeClashPlan(planId);
      const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || checkout.key_id;
      if (!keyId) {
        throw new Error("Razorpay key is not configured");
      }
      onCheckoutOpened?.();
      void waitForPaidPlan(planId);
      await openRazorpayCheckout({
        keyId,
        planName,
        subscriptionId: checkout.subscription_id,
        orderId: checkout.order_id,
        amount: checkout.amount,
        currency: checkout.currency,
        prefill: checkout.prefill,
        onDismiss: () => {
          setError(null);
          setConfirmingPlan(planId);
        },
        onFailed: (message) => {
          const lower = message.toLowerCase();
          if (lower.includes("international card")) {
            setError(
              "Razorpay rejected that card as international. In Test Mode choose UPI and enter success@razorpay, then Success on the mock screen."
            );
            return;
          }
          setError(message);
        },
        onPaid: async (response) => {
          const checkoutId =
            response.razorpay_order_id ||
            response.razorpay_subscription_id ||
            checkout.order_id ||
            checkout.subscription_id;
          if (checkoutId && response.razorpay_payment_id && response.razorpay_signature) {
            const next = await verifyClashOrderPayment({
              razorpay_order_id: response.razorpay_order_id || checkout.order_id,
              razorpay_subscription_id: response.razorpay_subscription_id || checkout.subscription_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            pollStopRef.current = true;
            setConfirmingPlan(null);
            onStatusChange(next);
            onClose();
            return;
          }
          const optimistic: ClashBillingStatus = {
            used: status?.used ?? 0,
            remaining: status?.remaining ?? (planId === "fearless" ? null : 50),
            period: status?.period || "",
            period_start: status?.period_start,
            period_end: status?.period_end,
            subscription_id: status?.subscription_id,
            razorpay_subscription_id: status?.razorpay_subscription_id,
            cancel_at_period_end: status?.cancel_at_period_end,
            current_period_end: status?.current_period_end,
            plan_id: planId,
            plan_name: planName,
            status: "active",
            limit: planId === "fearless" ? null : 50,
            can_start: true,
            price_paise: checkout.price_paise,
          };
          pollStopRef.current = true;
          setConfirmingPlan(null);
          onStatusChange(optimistic);
          onClose();
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyPlan(null);
    }
  };

  const handleCancel = async () => {
    setError(null);
    setBusyPlan("cancel");
    try {
      const next = await cancelClashSubscription();
      onStatusChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusyPlan(null);
    }
  };

  const sorted = [...plans].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clash-pricing-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]"
        aria-label="Close pricing"
        onClick={onClose}
      />
      <div className="relative z-[81] m-0 flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-[#00634B]/20 bg-[#F7FAF8] shadow-[0_24px_80px_-24px_rgba(0,99,75,0.45)] sm:m-4 sm:rounded-3xl">
        <div className="relative overflow-hidden border-b border-[#00634B]/10 px-5 pb-5 pt-5 sm:px-8 sm:pt-7">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 10% -20%, rgba(0,99,75,0.18), transparent 55%), radial-gradient(ellipse 50% 40% at 100% 0%, rgba(0,99,75,0.08), transparent 50%)",
            }}
          />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#00634B]/70">
                Clash Mode
              </p>
              <h2
                id="clash-pricing-title"
                className="mt-1 font-serif text-2xl tracking-tight text-slate-900 sm:text-3xl"
                style={{ fontFamily: "var(--font-instrument-serif, Georgia, serif)" }}
              >
                Upgrade your bench
              </h2>
              <p className="mt-1.5 max-w-md text-sm text-slate-600">
                Run more debates this month. Quotas reset on the 1st (UTC).
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white/80 p-2 text-slate-500 hover:text-slate-800"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          {status && (
            <p className="relative mt-4 text-xs text-slate-600">
              Current: <span className="font-semibold text-[#00634B]">{status.plan_name}</span>
              {status.limit != null ? (
                <>
                  {" "}
                  · {status.used}/{status.limit} sessions used in {status.period}
                </>
              ) : (
                <> · unlimited</>
              )}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" /> Loading plans…
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {sorted.map((plan) => {
                const isCurrent = plan.id === currentId;
                const isFearless = plan.id === "fearless";
                const isFree = plan.id === "free";
                return (
                  <div
                    key={plan.id}
                    className={`relative flex flex-col rounded-2xl border p-4 ${
                      isFearless
                        ? "border-[#00634B] bg-[#00634B] text-white shadow-lg shadow-[#00634B]/25"
                        : "border-slate-200/90 bg-white text-slate-900"
                    }`}
                  >
                    {isFearless && (
                      <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-900">
                        <Sparkles className="size-3" /> Recommended
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      {isFearless ? (
                        <Zap className="size-4 text-amber-200" />
                      ) : (
                        <Check className={`size-4 ${isCurrent ? "text-[#00634B]" : "text-slate-400"}`} />
                      )}
                      <h3 className={`text-sm font-semibold ${isFearless ? "text-white" : ""}`}>
                        {plan.name}
                      </h3>
                    </div>
                    <p className={`mt-3 text-2xl font-semibold tracking-tight ${isFearless ? "text-white" : ""}`}>
                      {plan.price_paise <= 0 ? "Free" : formatInr(plan.price_paise)}
                      {plan.price_paise > 0 && (
                        <span className={`text-sm font-normal ${isFearless ? "text-white/70" : "text-slate-500"}`}>
                          /mo
                        </span>
                      )}
                    </p>
                    <p className={`mt-1 text-xs ${isFearless ? "text-white/75" : "text-slate-500"}`}>
                      {limitLabel(plan.monthly_session_limit)}
                    </p>
                    <ul className={`mt-4 space-y-1.5 text-xs ${isFearless ? "text-white/85" : "text-slate-600"}`}>
                      <li className="flex gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0" />
                        Practice & Real Life modes
                      </li>
                      <li className="flex gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0" />
                        RAG-grounded Indian law
                      </li>
                      {!isFree && (
                        <li className="flex gap-2">
                          <Check className="mt-0.5 size-3.5 shrink-0" />
                          Priority for more debates
                        </li>
                      )}
                    </ul>
                    <div className="mt-5 flex-1" />
                    {isCurrent ? (
                      <Button
                        type="button"
                        variant={isFearless ? "secondary" : "outline"}
                        className="w-full"
                        disabled
                      >
                        Current plan
                      </Button>
                    ) : isFree ? (
                      <Button type="button" variant="ghost" className="w-full" disabled>
                        Included
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        className={
                          isFearless
                            ? "w-full bg-white text-[#00634B] hover:bg-white/90"
                            : "w-full bg-[#00634B] text-white hover:bg-[#005240]"
                        }
                        disabled={busyPlan != null}
                        onClick={() =>
                          void handleSubscribe(plan.id as "basic" | "fearless", plan.name)
                        }
                      >
                        {busyPlan === plan.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          `Go ${plan.name}`
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showingConfirm && (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-[#00634B]/20 bg-[#00634B]/8 px-3 py-2 text-xs text-[#00634B]">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              Confirming payment. If you paid with UPI, keep this tab open or come back — the plan updates even if Checkout closed.
            </p>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").startsWith("rzp_test_") && (
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Test Mode: do not use a real or foreign card. Open <span className="font-medium text-slate-700">UPI</span>{" "}
              and pay with <span className="font-mono text-slate-700">success@razorpay</span>.{" "}
              <code className="rounded bg-slate-100 px-1">4111…</code> is treated as an international card and will fail
              until International Cards are enabled in the Razorpay Dashboard.
            </p>
          )}

          {status && status.plan_id !== "free" && status.status === "active" && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-4">
              <p className="text-xs text-slate-500">
                {status.cancel_at_period_end
                  ? "Cancellation scheduled at period end."
                  : "Cancel anytime — access continues until the period ends."}
              </p>
              {!status.cancel_at_period_end && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyPlan != null}
                  onClick={() => void handleCancel()}
                >
                  {busyPlan === "cancel" ? <Loader2 className="size-4 animate-spin" /> : "Cancel plan"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
