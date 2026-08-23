"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  AdminTabPage,
  AdminToolbar,
  adminTableScroll,
} from "@/components/admin/AdminPageLayout";
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
  type AdminCaseDetail,
  type AdminCaseRow,
  type AdminCaseSource,
  type AdminUserRow,
} from "@/lib/adminApi";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

type View =
  | { kind: "users" }
  | { kind: "cases"; userId: string; userLabel: string; role?: string | null }
  | {
      kind: "case";
      userId: string;
      userLabel: string;
      role?: string | null;
      caseId: string;
      source?: AdminCaseSource;
    };

function userLabel(u: Pick<AdminUserRow, "email" | "mobile" | "display_name" | "id">): string {
  return u.display_name || u.email || u.mobile || u.id;
}

function scopeLabel(scope?: AdminCaseSource | null, role?: string | null): string {
  const r = (role || "").toLowerCase();
  if (scope === "lawyer_case" || r === "lawyer") return "Assigned lawyer cases";
  if (scope === "sahayak_case" || r === "sahayak") return "Assigned sahayak cases";
  if (scope === "intervention" || r === "moderator") return "Moderator interventions";
  return "Victim cases";
}

function sourceBadge(source?: AdminCaseSource | null): string {
  if (source === "lawyer_case") return "lawyer";
  if (source === "sahayak_case") return "sahayak";
  if (source === "intervention") return "moderator";
  return "victim";
}

function fmtWhen(value?: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

type PillKind = "account" | "role" | "case" | "source" | "pending";

const STATUS_HINTS: Record<PillKind, Record<string, string>> = {
  account: {
    active: "Account can sign in and use the platform normally.",
    disabled: "Account is blocked from signing in until an admin re-enables it.",
    pending_reset:
      "Password must be set via a one-time reset code (common for imported users) before normal login.",
  },
  role: {
    victim: "End user who files cases through chat.",
    sahayak: "Community helper; opens cases assigned to them in sahayak_cases.",
    lawyer: "Legal professional; opens cases assigned to them in lawyer_cases.",
    moderator: "Legal moderator; opens the shared interventions queue.",
    admin: "Platform administrator with admin console access.",
    super_admin: "Highest admin role; full administrative access.",
  },
  case: {
    pending: "Waiting for acceptance, review, or further action.",
    accepted: "Assigned worker has accepted this case.",
    reviewed: "Case was reviewed but may not be fully resolved yet.",
    resolved: "Work on this case is complete.",
    active: "Case is in progress.",
    closed: "Case is closed and no longer actionable.",
  },
  source: {
    victim: "Record from the victim’s own cases table.",
    lawyer: "Record from lawyer_cases (assigned to a lawyer).",
    sahayak: "Record from sahayak_cases (assigned to a sahayak).",
    moderator: "Record from the moderator interventions queue.",
  },
  pending: {
    pending: "Marked pending — needs attention or is waiting in a queue.",
    yes: "Marked pending — needs attention or is waiting in a queue.",
    no: "Not pending.",
  },
};

function statusHint(kind: PillKind | undefined, value: string): string | undefined {
  if (!kind) return undefined;
  const key = value.trim().toLowerCase();
  if (!key || key === "—") return undefined;
  return STATUS_HINTS[kind][key] || `Status: ${value}`;
}

function StatusPill({
  value,
  tone,
  kind,
  hint,
}: {
  value: string;
  tone?: "ok" | "warn" | "muted";
  kind?: PillKind;
  hint?: string;
}) {
  const title = hint || statusHint(kind, value);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const openTip = useCallback(() => {
    if (!title || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setCoords({ top: rect.top, left: rect.left + rect.width / 2 });
  }, [title]);

  const closeTip = useCallback(() => setCoords(null), []);

  useEffect(() => {
    if (!coords) return;
    const handle = () => closeTip();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [coords, closeTip]);

  return (
    <>
      <span
        ref={anchorRef}
        aria-label={title ? `${value}: ${title}` : value}
        onMouseEnter={openTip}
        onMouseLeave={closeTip}
        onFocus={openTip}
        onBlur={closeTip}
        tabIndex={title ? 0 : undefined}
        className={cn(
          "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium outline-none",
          title && "cursor-help focus-visible:ring-2 focus-visible:ring-white/20",
          tone === "ok" && "bg-emerald-500/15 text-emerald-300",
          tone === "warn" && "bg-amber-500/15 text-amber-200",
          (!tone || tone === "muted") && "bg-white/[0.06] text-white/60"
        )}
      >
        {value}
      </span>
      {title && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              style={{ top: coords.top, left: coords.left }}
              className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-[calc(100%+8px)]"
            >
              <div className="max-w-[260px] rounded-lg border border-white/10 bg-[#111114]/95 px-3 py-2 text-[11px] leading-snug text-white/85 shadow-xl shadow-black/40 backdrop-blur-sm">
                <span className="mb-0.5 block font-semibold text-white">{value}</span>
                {title}
              </div>
              <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-[#111114]/95" />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function PaginationBar({
  offset,
  total,
  loading,
  onPrev,
  onNext,
}: {
  offset: number;
  total: number;
  loading?: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  return (
    <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
      <button type="button" disabled={offset === 0 || loading} onClick={onPrev} className={adminBtnSecondary}>
        Prev
      </button>
      <span>
        Page {currentPage} / {pageCount}
        <span className="ml-2 text-white/35">({total.toLocaleString()} total)</span>
      </span>
      <button
        type="button"
        disabled={offset + PAGE_SIZE >= total || loading}
        onClick={onNext}
        className={adminBtnSecondary}
      >
        Next
      </button>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text = useMemo(() => {
    if (value === null || value === undefined) return "null";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <section className={`${adminCard} p-4`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">{title}</h3>
      <pre className="admin-no-scrollbar max-h-[420px] overflow-auto rounded-xl border border-white/[0.06] bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-white/70">
        {text}
      </pre>
    </section>
  );
}

function UsersView({
  onOpenUser,
}: {
  onOpenUser: (user: AdminUserRow) => void;
}) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [hasCases, setHasCases] = useState<"" | "true" | "false">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.users({
        q: q || undefined,
        role: role || undefined,
        status: status || undefined,
        has_cases: hasCases === "" ? undefined : hasCases === "true",
        offset,
        limit: PAGE_SIZE,
      });
      setUsers(res.users || []);
      setTotal(res.total || 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [q, role, status, hasCases, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [q, role, status, hasCases]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-white/[0.07] bg-black/90 px-5 py-3 backdrop-blur-md md:px-6">
        <AdminToolbar sticky>
          <form
            className="flex min-w-[220px] flex-1 basis-full gap-2 sm:max-w-sm sm:basis-auto"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(draftQ.trim());
            }}
          >
            <input
              className={cn(adminInput, "text-xs")}
              placeholder="Search email, mobile, name, id…"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
            />
            <button type="submit" className={adminBtnSecondary}>
              Search
            </button>
          </form>
          <select
            className={cn(adminSelect, "text-xs")}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="victim">victim</option>
            <option value="sahayak">sahayak</option>
            <option value="lawyer">lawyer</option>
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
            <option value="super_admin">super_admin</option>
          </select>
          <select
            className={cn(adminSelect, "text-xs")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
            <option value="pending_reset">pending_reset</option>
          </select>
          <select
            className={cn(adminSelect, "text-xs")}
            value={hasCases}
            onChange={(e) => setHasCases(e.target.value as "" | "true" | "false")}
            aria-label="Filter by cases"
          >
            <option value="">Any case count</option>
            <option value="true">Has cases</option>
            <option value="false">No cases</option>
          </select>
          <button type="button" className={adminBtnSecondary} onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <PaginationBar
            offset={offset}
            total={total}
            loading={loading}
            onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            onNext={() => setOffset((o) => o + PAGE_SIZE)}
          />
        </AdminToolbar>
      </div>

      {error && (
        <div className="px-5 pt-3 md:px-6">
          <AdminErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className={`${adminTableScroll} relative min-h-0 flex-1 px-5 md:px-6`}>
        {loading && users.length === 0 ? (
          <AdminLoading label="Loading users…" />
        ) : (
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead className="sticky top-0 z-[1] bg-[#111]">
              <tr className="text-xs text-white/45">
                <th className="border-b border-white/10 px-3 py-2 font-medium">User</th>
                <th
                  className="border-b border-white/10 px-3 py-2 font-medium"
                  title="Platform role — hover a badge for details"
                >
                  Role
                </th>
                <th
                  className="border-b border-white/10 px-3 py-2 font-medium"
                  title="Account status: active (can sign in), disabled (blocked), pending_reset (must set password)"
                >
                  Status
                </th>
                <th className="border-b border-white/10 px-3 py-2 font-medium">Workload</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium">Created</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-white/35">
                    No users match these filters.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    className="cursor-pointer border-t border-white/[0.06] text-white/75 transition hover:bg-white/[0.03]"
                    onClick={() => onOpenUser(u)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-white/90">{userLabel(u)}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-white/35">{u.id}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill value={u.role || "—"} kind="role" />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill
                        value={u.status || "—"}
                        kind="account"
                        tone={u.status === "active" ? "ok" : u.status === "disabled" ? "warn" : "muted"}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs">{u.case_count ?? 0}</div>
                      <div className="mt-0.5 text-[10px] text-white/30">
                        {scopeLabel(u.case_scope, u.role).replace(/ cases$/i, "").replace(/ interventions$/i, "")}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-white/45">
                      {fmtWhen(u.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-white/35">
                      <ChevronRight className="ml-auto h-4 w-4" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CasesView({
  userId,
  userLabel: label,
  role: initialRole,
  onBack,
  onOpenCase,
}: {
  userId: string;
  userLabel: string;
  role?: string | null;
  onBack: () => void;
  onOpenCase: (c: AdminCaseRow) => void;
}) {
  const [cases, setCases] = useState<AdminCaseRow[]>([]);
  const [user, setUser] = useState<AdminUserRow | null>(null);
  const [caseScope, setCaseScope] = useState<AdminCaseSource | undefined>();
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<"" | "true" | "false">("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = user?.role || initialRole;

  useEffect(() => {
    void adminApi
      .caseStatuses(role || undefined)
      .then((r) => setStatuses(r.statuses || []))
      .catch(() => undefined);
  }, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.userCases(userId, {
        q: q || undefined,
        status: status || undefined,
        pending: pending === "" ? undefined : pending === "true",
        offset,
        limit: PAGE_SIZE,
      });
      setCases(res.cases || []);
      setUser(res.user || null);
      setCaseScope(res.case_scope);
      setTotal(res.total || 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load cases");
    } finally {
      setLoading(false);
    }
  }, [userId, q, status, pending, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [q, status, pending, userId]);

  const emptyCopy =
    (role || "").toLowerCase() === "lawyer"
      ? "No assigned lawyer cases for this user."
      : (role || "").toLowerCase() === "sahayak"
        ? "No assigned sahayak cases for this user."
        : (role || "").toLowerCase() === "moderator"
          ? "No moderator interventions found."
          : "No victim cases for this user.";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-white/[0.07] bg-black/90 px-5 py-3 backdrop-blur-md md:px-6">
        <AdminToolbar sticky>
          <button type="button" className={adminBtnSecondary} onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to users
          </button>
          <form
            className="flex min-w-[220px] flex-1 basis-full gap-2 sm:max-w-sm sm:basis-auto"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(draftQ.trim());
            }}
          >
            <input
              className={cn(adminInput, "text-xs")}
              placeholder="Search case id, type, summary…"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
            />
            <button type="submit" className={adminBtnSecondary}>
              Search
            </button>
          </form>
          <select
            className={cn(adminSelect, "text-xs")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by case status"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className={cn(adminSelect, "text-xs")}
            value={pending}
            onChange={(e) => setPending(e.target.value as "" | "true" | "false")}
            aria-label="Filter by pending"
          >
            <option value="">Any pending</option>
            <option value="true">Pending</option>
            <option value="false">Not pending</option>
          </select>
          <button type="button" className={adminBtnSecondary} onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <PaginationBar
            offset={offset}
            total={total}
            loading={loading}
            onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            onNext={() => setOffset((o) => o + PAGE_SIZE)}
          />
        </AdminToolbar>
        <p className="mt-2 text-xs text-white/40">
          {scopeLabel(caseScope, role)} for{" "}
          <span className="text-white/70">{user ? userLabel(user) : label}</span>
          {user?.role ? <span className="text-white/35"> · {user.role}</span> : null}
          {user?.email ? <span className="text-white/35"> · {user.email}</span> : null}
        </p>
      </div>

      {error && (
        <div className="px-5 pt-3 md:px-6">
          <AdminErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className={`${adminTableScroll} relative min-h-0 flex-1 px-5 md:px-6`}>
        {loading && cases.length === 0 ? (
          <AdminLoading label="Loading cases…" />
        ) : (
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead className="sticky top-0 z-[1] bg-[#111]">
              <tr className="text-xs text-white/45">
                <th className="border-b border-white/10 px-3 py-2 font-medium">Case</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium">Source</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium">Type</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium">Status</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium">Pending</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium">Updated</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-white/35">
                    {emptyCopy}
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr
                    key={`${c.source || "case"}-${c.id}`}
                    className="cursor-pointer border-t border-white/[0.06] text-white/75 transition hover:bg-white/[0.03]"
                    onClick={() => onOpenCase(c)}
                  >
                    <td className="max-w-xs px-3 py-2.5">
                      <div className="truncate font-mono text-xs text-white/85">{c.id}</div>
                      {c.summary_preview ? (
                        <div className="mt-0.5 truncate text-[11px] text-white/40">{c.summary_preview}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill value={sourceBadge(c.source)} kind="source" />
                    </td>
                    <td className="px-3 py-2.5 text-xs">{c.incident_type || "—"}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill value={c.status || "—"} kind="case" />
                    </td>
                    <td className="px-3 py-2.5">
                      {c.pending ? (
                        <StatusPill value="pending" kind="pending" tone="warn" />
                      ) : (
                        <StatusPill value="no" kind="pending" tone="muted" />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-white/45">
                      {fmtWhen(c.updated_at || c.timestamp)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-white/35">
                      <ChevronRight className="ml-auto h-4 w-4" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CaseDetailView({
  caseId,
  source,
  userLabel: label,
  onBack,
}: {
  caseId: string;
  source?: AdminCaseSource;
  userLabel: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<AdminCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionQ, setSectionQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.caseDetail(caseId, source);
      setDetail(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load case");
    } finally {
      setLoading(false);
    }
  }, [caseId, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const caseRow = detail?.case || {};
  const filter = sectionQ.trim().toLowerCase();
  const resolvedSource = detail?.source || source;

  const sections = useMemo(() => {
    const all: { key: string; title: string; value: unknown }[] = [
      { key: "structured_report", title: "Structured report", value: caseRow.structured_report },
      { key: "session_data", title: "Session / chat transcript", value: caseRow.session_data },
      { key: "situation_summary", title: "Situation summary", value: caseRow.situation_summary },
      { key: "collected_answers", title: "Collected answers", value: caseRow.collected_answers },
      { key: "user_statement", title: "User statement", value: caseRow.user_statement },
      { key: "moderator_response", title: "Moderator response", value: caseRow.moderator_response },
      { key: "moderator_options", title: "Moderator options", value: caseRow.moderator_options },
      { key: "routing", title: "Routing recommendation", value: caseRow.routing_recommendation },
      {
        key: "location",
        title: "Location",
        value:
          caseRow.location ||
          (caseRow.structured_report as { location?: unknown } | undefined)?.location,
      },
      { key: "interventions", title: "Related interventions", value: detail?.interventions },
      { key: "sahayak", title: "Related sahayak cases", value: detail?.sahayak_cases },
      { key: "lawyer", title: "Related lawyer cases", value: detail?.lawyer_cases },
    ];
    const nonempty = all.filter((s) => s.value !== undefined && s.value !== null && s.value !== "");
    if (!filter) return nonempty;
    return nonempty.filter((s) => {
      if (s.title.toLowerCase().includes(filter) || s.key.includes(filter)) return true;
      try {
        return JSON.stringify(s.value ?? "").toLowerCase().includes(filter);
      } catch {
        return false;
      }
    });
  }, [caseRow, detail, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-white/[0.07] bg-black/90 px-5 py-3 backdrop-blur-md md:px-6">
        <AdminToolbar sticky>
          <button type="button" className={adminBtnSecondary} onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to cases
          </button>
          <input
            className={cn(adminInput, "min-w-[200px] flex-1 basis-full text-xs sm:max-w-sm sm:basis-auto")}
            placeholder="Filter sections / JSON…"
            value={sectionQ}
            onChange={(e) => setSectionQ(e.target.value)}
          />
          <button type="button" className={adminBtnSecondary} onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </AdminToolbar>
        <p className="mt-2 truncate font-mono text-xs text-white/45">
          {caseId}
          <span className="text-white/30">
            {" "}
            · {sourceBadge(resolvedSource)} · {label}
          </span>
        </p>
      </div>

      <div className={`${adminTableScroll} min-h-0 flex-1 px-5 py-4 md:px-6`}>
        {error && <AdminErrorBanner message={error} onDismiss={() => setError(null)} />}
        {loading && !detail ? (
          <AdminLoading label="Loading case detail…" />
        ) : detail ? (
          <div className="space-y-4">
            <section className={`${adminCard} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4`}>
              <Meta label="Source" value={sourceBadge(resolvedSource)} />
              <Meta label="Status" value={String(caseRow.status ?? "—")} />
              <Meta
                label="Pending"
                value={
                  caseRow.pending === true || caseRow.status === "pending"
                    ? "yes"
                    : caseRow.pending === false
                      ? "no"
                      : String(caseRow.pending ?? "—")
                }
              />
              <Meta label="Incident type" value={String(detail.incident_type || "—")} />
              <Meta label="Language" value={String(caseRow.user_language ?? "—")} />
              <Meta label="Session" value={String(caseRow.session_id ?? "—")} mono />
              <Meta
                label="Created"
                value={fmtWhen(String(caseRow.timestamp ?? caseRow.created_at ?? ""))}
              />
              <Meta label="Updated" value={fmtWhen(String(caseRow.updated_at ?? ""))} />
              {caseRow.assigned_lawyer_id ? (
                <Meta label="Assigned lawyer" value={String(caseRow.assigned_lawyer_id)} mono />
              ) : null}
              {caseRow.assigned_sahayak_id ? (
                <Meta
                  label="Assigned sahayak"
                  value={`${caseRow.assigned_sahayak_name || ""} ${caseRow.assigned_sahayak_id}`.trim()}
                  mono
                />
              ) : null}
              <Meta
                label="PDF"
                value={
                  caseRow.pdf_url ? (
                    <a
                      href={String(caseRow.pdf_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-300 hover:underline"
                    >
                      Open PDF
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              {detail.user ? (
                <Meta
                  label="Victim / owner"
                  value={`${userLabel(detail.user)}${detail.user.email ? ` · ${detail.user.email}` : ""}`}
                />
              ) : null}
            </section>

            {sections.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/35">No sections match this filter.</p>
            ) : (
              sections.map((s) => <JsonBlock key={s.key} title={s.title} value={s.value} />)
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">{label}</dt>
      <dd className={cn("mt-1 break-all text-sm text-white/80", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}

export function AdminCasesPanel() {
  const [view, setView] = useState<View>({ kind: "users" });

  const title =
    view.kind === "users"
      ? "User cases"
      : view.kind === "cases"
        ? "User cases"
        : "Case detail";

  const description =
    view.kind === "users"
      ? "Victims open their cases; lawyers/sahayak open assigned cases; moderators open interventions."
      : view.kind === "cases"
        ? `${scopeLabel(undefined, view.role)} for ${view.userLabel}`
        : `Full status and payloads for ${view.caseId}`;

  return (
    <AdminTabPage badge="Cases" title={title} description={description} className="!p-0 !overflow-hidden flex flex-col">
      {view.kind === "users" && (
        <UsersView
          onOpenUser={(u) =>
            setView({ kind: "cases", userId: u.id, userLabel: userLabel(u), role: u.role })
          }
        />
      )}
      {view.kind === "cases" && (
        <CasesView
          userId={view.userId}
          userLabel={view.userLabel}
          role={view.role}
          onBack={() => setView({ kind: "users" })}
          onOpenCase={(c) =>
            setView({
              kind: "case",
              userId: view.userId,
              userLabel: view.userLabel,
              role: view.role,
              caseId: c.id,
              source: c.source,
            })
          }
        />
      )}
      {view.kind === "case" && (
        <CaseDetailView
          caseId={view.caseId}
          source={view.source}
          userLabel={view.userLabel}
          onBack={() =>
            setView({
              kind: "cases",
              userId: view.userId,
              userLabel: view.userLabel,
              role: view.role,
            })
          }
        />
      )}
    </AdminTabPage>
  );
}
