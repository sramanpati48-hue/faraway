"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { AdminTabPage } from "@/components/admin/AdminPageLayout";
import {
  AdminErrorBanner,
  AdminLoading,
  adminBtnSecondary,
  adminCard,
  adminInput,
  adminSelect,
} from "@/components/admin/admin-ui";
import {
  adminApi,
  type AdminBillingEvent,
  type AdminBillingSubscription,
  type AdminBillingSummary,
} from "@/lib/adminApi";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

type Section = "subscriptions" | "transactions";

function formatInr(paise?: number | null): string {
  if (paise == null || Number.isNaN(paise)) return "—";
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function userLabel(row: {
  display_name?: string | null;
  email?: string | null;
  mobile?: string | null;
  user_id?: string | null;
}): string {
  return row.display_name?.trim() || row.email || row.mobile || (row.user_id ? row.user_id.slice(0, 8) : "—");
}

function statusClass(status?: string | null): string {
  if (status === "active") return "bg-emerald-500/15 text-emerald-300";
  if (status === "created") return "bg-sky-500/15 text-sky-300";
  if (status === "past_due") return "bg-amber-500/15 text-amber-300";
  if (status === "cancelled" || status === "expired") return "bg-red-500/15 text-red-300";
  if (status === "captured" || status === "paid") return "bg-emerald-500/15 text-emerald-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-white/60";
}

export function AdminPaymentsPanel() {
  const [section, setSection] = useState<Section>("subscriptions");
  const [summary, setSummary] = useState<AdminBillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [subs, setSubs] = useState<AdminBillingSubscription[]>([]);
  const [subsTotal, setSubsTotal] = useState(0);
  const [subsPage, setSubsPage] = useState(0);
  const [subsLoading, setSubsLoading] = useState(true);
  const [subStatus, setSubStatus] = useState("all");
  const [subPlan, setSubPlan] = useState("all");
  const [subQ, setSubQ] = useState("");
  const [subQDebounced, setSubQDebounced] = useState("");

  const [events, setEvents] = useState<AdminBillingEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventType, setEventType] = useState("all");
  const [eventQ, setEventQ] = useState("");
  const [eventQDebounced, setEventQDebounced] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<AdminBillingEvent | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSubQDebounced(subQ.trim()), 250);
    return () => window.clearTimeout(t);
  }, [subQ]);

  useEffect(() => {
    const t = window.setTimeout(() => setEventQDebounced(eventQ.trim()), 250);
    return () => window.clearTimeout(t);
  }, [eventQ]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await adminApi.billingSummary());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load billing summary");
    }
  }, []);

  const loadSubs = useCallback(async (pageIndex: number) => {
    setSubsLoading(true);
    setError(null);
    try {
      const res = await adminApi.billingSubscriptions({
        q: subQDebounced || undefined,
        status: subStatus === "all" ? undefined : subStatus,
        plan_id: subPlan === "all" ? undefined : subPlan,
        limit: PAGE_SIZE,
        offset: pageIndex * PAGE_SIZE,
      });
      setSubs(res.subscriptions || []);
      setSubsTotal(res.total || 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load subscriptions");
    } finally {
      setSubsLoading(false);
    }
  }, [subPlan, subQDebounced, subStatus]);

  const loadEvents = useCallback(async (pageIndex: number) => {
    setEventsLoading(true);
    setError(null);
    try {
      const res = await adminApi.billingEvents({
        q: eventQDebounced || undefined,
        event_type: eventType === "all" ? undefined : eventType,
        limit: PAGE_SIZE,
        offset: pageIndex * PAGE_SIZE,
      });
      setEvents(res.events || []);
      setEventsTotal(res.total || 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setEventsLoading(false);
    }
  }, [eventQDebounced, eventType]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setSubsPage(0);
  }, [subStatus, subPlan, subQDebounced]);

  useEffect(() => {
    void loadSubs(subsPage);
  }, [loadSubs, subsPage]);

  useEffect(() => {
    setEventsPage(0);
  }, [eventType, eventQDebounced]);

  useEffect(() => {
    if (section !== "transactions") return;
    void loadEvents(eventsPage);
  }, [loadEvents, eventsPage, section]);

  const refresh = () => {
    void loadSummary();
    if (section === "subscriptions") void loadSubs(subsPage);
    else void loadEvents(eventsPage);
  };

  const counts = summary?.subscriptions || {};
  const subsPages = Math.max(1, Math.ceil(subsTotal / PAGE_SIZE));
  const eventPages = Math.max(1, Math.ceil(eventsTotal / PAGE_SIZE));

  return (
    <AdminTabPage
      badge="Billing"
      title="Payments & subscriptions"
      description="Clash Razorpay checkouts, plan status, and webhook payment events with user details."
      actions={
        <button type="button" className={adminBtnSecondary} onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      }
    >
      {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Active" value={String(counts.active || 0)} hint="Current paid Clash plans" />
        <SummaryCard
          label="MRR"
          value={formatInr(summary?.mrr_paise)}
          hint={
            (summary?.active_by_plan || [])
              .map((p) => `${p.plan_name} × ${p.count}`)
              .join(" · ") || "From active subscriptions"
          }
        />
        <SummaryCard label="Pending checkout" value={String(counts.created || 0)} hint="Created, not yet paid" />
        <SummaryCard
          label="Webhook events"
          value={String(summary?.events_total || 0)}
          hint="Stored Razorpay payloads"
        />
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
        {(["subscriptions", "transactions"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize",
              section === id ? "bg-emerald-600/20 text-emerald-200" : "text-white/50 hover:text-white/80"
            )}
          >
            {id}
          </button>
        ))}
      </div>

      {section === "subscriptions" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={cn(adminInput, "w-full max-w-xs text-xs")}
              placeholder="Search email, mobile, Razorpay id…"
              value={subQ}
              onChange={(e) => setSubQ(e.target.value)}
            />
            <select className={cn(adminSelect, "text-xs")} value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="created">Created</option>
              <option value="past_due">Past due</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
            <select className={cn(adminSelect, "text-xs")} value={subPlan} onChange={(e) => setSubPlan(e.target.value)}>
              <option value="all">All plans</option>
              <option value="basic">Basic</option>
              <option value="fearless">Fearless</option>
              <option value="free">Free</option>
            </select>
            <p className="ml-auto text-xs text-white/40">{subsTotal.toLocaleString()} subscriptions</p>
          </div>
          {subsLoading && subs.length === 0 ? (
            <AdminLoading label="Loading subscriptions…" />
          ) : (
            <div className={cn("overflow-x-auto rounded-[20px] border border-white/[0.09]", subsLoading && "opacity-60")}>
              <table className="min-w-full text-left text-xs">
                <thead className="bg-white/[0.03] text-white/45">
                  <tr>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Razorpay</th>
                    <th className="px-3 py-2 font-medium">Period</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-white/35">
                        No subscriptions yet.
                      </td>
                    </tr>
                  ) : (
                    subs.map((row) => (
                      <tr key={row.id} className="border-t border-white/[0.06] text-white/75">
                        <td className="px-3 py-2">
                          <p className="font-medium text-white/90">{userLabel(row)}</p>
                          <p className="font-mono text-[10px] text-white/40">
                            {[row.email, row.mobile].filter(Boolean).join(" · ") || row.user_id}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          {row.plan_name || row.plan_id}{" "}
                          <span className="text-white/40">{formatInr(row.price_paise)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusClass(row.status))}>
                            {row.status}
                            {row.cancel_at_period_end ? " · canceling" : ""}
                          </span>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2 font-mono text-[11px] text-white/55">
                          {row.razorpay_subscription_id || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[11px] text-white/50">
                          {formatDate(row.current_period_start)}
                          <br />
                          {formatDate(row.current_period_end)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-white/45">
                          {formatDate(row.updated_at)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={subsPage} pages={subsPages} total={subsTotal} loading={subsLoading} onPage={setSubsPage} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={cn(adminInput, "w-full max-w-xs text-xs")}
              placeholder="Search payment id, email, event…"
              value={eventQ}
              onChange={(e) => setEventQ(e.target.value)}
            />
            <select className={cn(adminSelect, "text-xs")} value={eventType} onChange={(e) => setEventType(e.target.value)}>
              <option value="all">All events</option>
              <option value="payment.captured">payment.captured</option>
              <option value="order.paid">order.paid</option>
              <option value="payment.failed">payment.failed</option>
              <option value="subscription.activated">subscription.activated</option>
              <option value="subscription.charged">subscription.charged</option>
              <option value="subscription.cancelled">subscription.cancelled</option>
              <option value="subscription.completed">subscription.completed</option>
              <option value="subscription.pending">subscription.pending</option>
            </select>
            <p className="ml-auto text-xs text-white/40">{eventsTotal.toLocaleString()} events</p>
          </div>
          {eventsLoading && events.length === 0 ? (
            <AdminLoading label="Loading transactions…" />
          ) : (
            <div className={cn("overflow-x-auto rounded-[20px] border border-white/[0.09]", eventsLoading && "opacity-60")}>
              <table className="min-w-full text-left text-xs">
                <thead className="bg-white/[0.03] text-white/45">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Payment / order</th>
                    <th className="px-3 py-2 font-medium">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-white/35">
                        No webhook events yet. Events appear after Razorpay posts to the live webhook.
                      </td>
                    </tr>
                  ) : (
                    events.map((row) => (
                      <tr
                        key={String(row.id)}
                        className="cursor-pointer border-t border-white/[0.06] text-white/75 hover:bg-white/[0.03]"
                        onClick={() => setSelectedEvent(row)}
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-white/50">
                          {formatDate(row.processed_at)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusClass(row.payment_status || row.event_type))}>
                            {row.event_type}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-white/90">{userLabel(row)}</p>
                          <p className="font-mono text-[10px] text-white/40">
                            {row.email || row.payment_email || row.mobile || row.payment_contact || row.user_id || "—"}
                          </p>
                        </td>
                        <td className="px-3 py-2">{formatInr(row.amount_paise)}</td>
                        <td className="max-w-[200px] truncate px-3 py-2 font-mono text-[11px] text-white/55">
                          {row.payment_id || row.order_id || row.subscription_id || row.razorpay_event_id}
                        </td>
                        <td className="px-3 py-2 text-white/55">{row.method || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={eventsPage} pages={eventPages} total={eventsTotal} loading={eventsLoading} onPage={setEventsPage} />
        </div>
      )}

      {selectedEvent && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close" onClick={() => setSelectedEvent(null)} />
          <div className={cn(adminCard, "relative z-[91] max-h-[85vh] w-full max-w-2xl overflow-hidden p-0")}>
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">Webhook payload</p>
                <p className="font-mono text-[11px] text-white/40">{selectedEvent.razorpay_event_id}</p>
              </div>
              <button type="button" className={adminBtnSecondary} onClick={() => setSelectedEvent(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="admin-scrollbar max-h-[70vh] overflow-auto p-4 text-[11px] text-white/70">
              {JSON.stringify(selectedEvent.payload || selectedEvent, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </AdminTabPage>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={cn(adminCard, "p-4")}>
      <p className="text-[11px] uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      <p className="mt-1 truncate text-[11px] text-white/35">{hint}</p>
    </div>
  );
}

function Pager({
  page,
  pages,
  total,
  loading,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  loading: boolean;
  onPage: (n: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-white/40">
      <span>
        Page {page + 1} / {pages}
      </span>
      <button
        type="button"
        className={cn(adminBtnSecondary, "px-2 py-1")}
        disabled={page === 0 || loading}
        onClick={() => onPage(Math.max(0, page - 1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(adminBtnSecondary, "px-2 py-1")}
        disabled={page + 1 >= pages || loading}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
