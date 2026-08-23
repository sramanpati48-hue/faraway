const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return { "Content-Type": "application/json" };
  const token = localStorage.getItem("nyaya_access_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type ClashPlanId = "free" | "basic" | "fearless";

export type ClashPlan = {
  id: ClashPlanId | string;
  name: string;
  price_paise: number;
  monthly_session_limit: number | null;
  sort_order?: number;
};

export type ClashBillingStatus = {
  plan_id: ClashPlanId | string;
  plan_name: string;
  price_paise: number;
  status: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  can_start: boolean;
  period: string;
  period_start?: string;
  period_end?: string;
  subscription_id?: string | null;
  razorpay_subscription_id?: string | null;
  cancel_at_period_end?: boolean;
  current_period_end?: string | null;
};

export type ClashSubscribeResult = {
  key_id: string;
  checkout_mode?: "subscription" | "order";
  subscription_id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  plan_id: string;
  price_paise: number;
  prefill?: { email?: string };
};

export type ClashQuotaDetail = {
  code?: string;
  plan?: string;
  used?: number;
  limit?: number;
  period?: string;
  message?: string;
};

async function parseBilling<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    const msg =
      typeof detail === "string"
        ? detail
        : typeof detail === "object" && detail && "message" in detail
          ? String((detail as { message: string }).message)
          : "Billing request failed";
    const err = new Error(msg) as Error & { status?: number; detail?: unknown };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return data as T;
}

export async function fetchClashBillingStatus(): Promise<ClashBillingStatus> {
  return parseBilling(
    await fetch(`${API_URL}/api/clash/billing/status`, { headers: authHeaders() })
  );
}

export async function fetchClashBillingPlans(): Promise<ClashPlan[]> {
  const data = await parseBilling<{ plans: ClashPlan[] }>(
    await fetch(`${API_URL}/api/clash/billing/plans`, { headers: authHeaders() })
  );
  return data.plans || [];
}

export async function subscribeClashPlan(planId: "basic" | "fearless"): Promise<ClashSubscribeResult> {
  return parseBilling(
    await fetch(`${API_URL}/api/clash/billing/subscribe`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ plan_id: planId }),
    })
  );
}

export async function verifyClashOrderPayment(args: {
  razorpay_order_id?: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  razorpay_subscription_id?: string;
}): Promise<ClashBillingStatus> {
  return parseBilling(
    await fetch(`${API_URL}/api/clash/billing/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(args),
    })
  );
}

export async function syncClashBilling(): Promise<ClashBillingStatus> {
  return parseBilling(
    await fetch(`${API_URL}/api/clash/billing/sync`, {
      method: "POST",
      headers: authHeaders(),
    })
  );
}

export async function cancelClashSubscription(): Promise<ClashBillingStatus> {
  return parseBilling(
    await fetch(`${API_URL}/api/clash/billing/cancel`, {
      method: "POST",
      headers: authHeaders(),
    })
  );
}

export function isClashQuotaError(err: unknown): err is Error & { status: number; detail: ClashQuotaDetail } {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; detail?: ClashQuotaDetail | string; message?: string };
  if (e.status !== 402) return false;
  const d = e.detail;
  if (typeof d === "object" && d && d.code === "clash_quota_exceeded") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  if (msg.includes("clash_quota_exceeded")) return true;
  if (typeof d === "string" && d.includes("clash_quota_exceeded")) return true;
  return false;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (resp: unknown) => void) => void;
    };
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

export function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Razorpay script failed")));
      if (window.Razorpay) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay Checkout"));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

export async function openRazorpayCheckout(args: {
  keyId: string;
  planName: string;
  name?: string;
  description?: string;
  subscriptionId?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  prefill?: { email?: string };
  onPaid?: (response: {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
    razorpay_subscription_id?: string;
  }) => void | Promise<void>;
  onDismiss?: () => void;
  onFailed?: (message: string) => void;
}): Promise<void> {
  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error("Razorpay Checkout unavailable");
  const options: Record<string, unknown> = {
    key: args.keyId,
    name: args.name || "NyaySahayak Clash",
    description: args.description || `${args.planName} monthly`,
    theme: { color: "#00634B" },
    handler: (response: {
      razorpay_payment_id?: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
      razorpay_subscription_id?: string;
    }) => {
      void args.onPaid?.(response);
    },
    modal: {
      ondismiss: () => args.onDismiss?.(),
    },
  };
  if (args.subscriptionId) options.subscription_id = args.subscriptionId;
  if (args.orderId) {
    options.order_id = args.orderId;
    if (args.amount) options.amount = args.amount;
    if (args.currency) options.currency = args.currency;
  }
  if (args.prefill?.email) options.prefill = args.prefill;
  const rzp = new window.Razorpay(options);
  rzp.on("payment.failed", (resp: unknown) => {
    const err = resp as { error?: { description?: string; reason?: string } };
    const msg = err?.error?.description || err?.error?.reason || "Payment failed";
    args.onFailed?.(msg);
  });
  rzp.open();
}
