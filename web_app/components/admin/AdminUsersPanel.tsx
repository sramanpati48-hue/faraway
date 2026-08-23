"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldBan,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  AdminMainPanel,
  AdminNavItem,
  AdminSidebarSearch,
  AdminToolbar,
  AdminWorkspace,
} from "@/components/admin/AdminPageLayout";
import {
  adminBtnDanger,
  adminBtnPrimary,
  adminBtnSecondary,
  adminInput,
  adminSelect,
} from "@/components/admin/admin-ui";
import { adminApi, type AdminUserRow } from "@/lib/adminApi";
import { cn } from "@/lib/utils";
import { PasswordInput } from "@/components/auth/PasswordInput";

const PAGE_SIZE = 25;

type RoleFilter =
  | "all"
  | "victim"
  | "sahayak"
  | "lawyer"
  | "moderator"
  | "admin"
  | "super_admin";

type CreateRole = Exclude<RoleFilter, "all">;

const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
  { id: "all", label: "All users" },
  { id: "victim", label: "Victims" },
  { id: "sahayak", label: "Sahayak" },
  { id: "lawyer", label: "Lawyers" },
  { id: "moderator", label: "Moderators" },
  { id: "admin", label: "Admins" },
  { id: "super_admin", label: "Super admins" },
];

const CREATE_ROLES: { id: CreateRole; label: string }[] = [
  { id: "victim", label: "Victim" },
  { id: "sahayak", label: "Sahayak" },
  { id: "lawyer", label: "Lawyer" },
  { id: "moderator", label: "Moderator" },
  { id: "admin", label: "Admin" },
  { id: "super_admin", label: "Super admin" },
];

const ROLE_LABELS: Record<string, string> = {
  victim: "Victim",
  sahayak: "Sahayak",
  lawyer: "Lawyer",
  moderator: "Moderator",
  admin: "Admin",
  super_admin: "Super admin",
};

const EMPTY_CREATE = {
  email: "",
  mobile: "",
  display_name: "",
  role: "victim" as CreateRole,
  password: "",
  confirm_password: "",
};

function roleBadgeClass(role: string) {
  if (role === "super_admin") return "bg-violet-500/20 text-violet-300";
  if (role === "admin") return "bg-blue-500/20 text-blue-300";
  if (role === "moderator") return "bg-amber-500/20 text-amber-300";
  if (role === "lawyer") return "bg-sky-500/20 text-sky-300";
  if (role === "sahayak") return "bg-teal-500/20 text-teal-300";
  return "bg-emerald-500/20 text-emerald-300";
}

function statusBadgeClass(status: string) {
  if (status === "active") return "bg-emerald-500/15 text-emerald-300";
  if (status === "disabled") return "bg-red-500/15 text-red-300";
  if (status === "pending_reset") return "bg-amber-500/15 text-amber-300";
  return "bg-white/10 text-white/60";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function displayName(u: AdminUserRow) {
  return u.display_name?.trim() || u.email || u.mobile || u.id.slice(0, 8);
}

export function AdminUsersPanel() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manualPassword, setManualPassword] = useState("");
  const [confirmManualPassword, setConfirmManualPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [modalMsg, setModalMsg] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState<{ code: string; expires_at?: string } | null>(null);

  useEffect(() => {
    if (!selected && !createOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (createOpen) {
        setCreateOpen(false);
        return;
      }
      setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, createOpen]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setOffset(0);
    setSelected(null);
  }, [roleFilter, searchDebounced]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminApi.users({
        q: searchDebounced || undefined,
        role: roleFilter === "all" ? undefined : roleFilter,
        offset,
        limit: PAGE_SIZE,
      });
      setUsers(res.users || []);
      setTotal(res.total || 0);
      setSelected((prev) => {
        if (!prev) return null;
        const updated = (res.users || []).find((u) => u.id === prev.id);
        return updated ?? prev;
      });
    } catch (e) {
      setUsers([]);
      setTotal(0);
      setMsg(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [roleFilter, searchDebounced, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + users.length, total);

  function openUser(user: AdminUserRow) {
    setSelected(user);
    setModalMsg(null);
    setResetCode(null);
    setManualPassword("");
    setConfirmManualPassword("");
  }

  function closeUserModal() {
    setSelected(null);
    setModalMsg(null);
    setResetCode(null);
    setManualPassword("");
    setConfirmManualPassword("");
  }

  function openCreateModal() {
    setCreateForm(EMPTY_CREATE);
    setCreateMsg(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCreateMsg(null);
    setCreateForm(EMPTY_CREATE);
  }

  async function handleCreateUser() {
    const email = createForm.email.trim();
    const mobile = createForm.mobile.trim();
    if (!email && !mobile) {
      setCreateMsg("Email or mobile is required.");
      return;
    }
    if (createForm.password.length < 8) {
      setCreateMsg("Password must be at least 8 characters.");
      return;
    }
    if (createForm.password !== createForm.confirm_password) {
      setCreateMsg("Passwords do not match.");
      return;
    }
    setBusy(true);
    setCreateMsg(null);
    try {
      const res = await adminApi.createUser({
        email: email || null,
        mobile: mobile || null,
        password: createForm.password,
        role: createForm.role,
        display_name: createForm.display_name.trim() || null,
      });
      closeCreateModal();
      setMsg(`Created ${displayName(res.user)}.`);
      await load();
      openUser(res.user);
    } catch (e) {
      setCreateMsg(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  async function handleManualReset(userId: string) {
    if (manualPassword.length < 8) {
      setModalMsg("Password must be at least 8 characters.");
      return;
    }
    if (manualPassword !== confirmManualPassword) {
      setModalMsg("Passwords do not match.");
      return;
    }
    if (!window.confirm("Set this password for the user? Their sessions will be revoked.")) return;
    setBusy(true);
    setModalMsg(null);
    try {
      const res = await adminApi.resetUserPassword(userId, manualPassword);
      setModalMsg(res.message ?? "Password updated.");
      setManualPassword("");
      setConfirmManualPassword("");
      await load();
    } catch (e) {
      setModalMsg(e instanceof Error ? e.message : "Password reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateResetCode(user: AdminUserRow) {
    const identifier = user.email || user.mobile;
    if (!identifier) {
      setModalMsg("User has no email or mobile to issue a reset code.");
      return;
    }
    if (!window.confirm(`Generate a one-time reset code for ${identifier}?`)) return;
    setBusy(true);
    setModalMsg(null);
    setResetCode(null);
    try {
      const res = (await adminApi.createResetCode(identifier)) as {
        reset_code?: string;
        expires_at?: string;
      };
      if (res.reset_code) {
        setResetCode({ code: res.reset_code, expires_at: res.expires_at });
        setModalMsg("Reset code generated. Share it with the user.");
      } else {
        setModalMsg("Reset code created.");
      }
      await load();
    } catch (e) {
      setModalMsg(e instanceof Error ? e.message : "Failed to create reset code");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleRestrict(user: AdminUserRow) {
    const next = user.status === "disabled" ? "active" : "disabled";
    const label = next === "disabled" ? "Restrict (disable) this user?" : "Unrestrict (re-enable) this user?";
    if (!window.confirm(label)) return;
    setBusy(true);
    setModalMsg(null);
    try {
      const res = await adminApi.patchUser(user.id, { status: next });
      setSelected(res.user);
      setModalMsg(next === "disabled" ? "User restricted." : "User unrestricted.");
      await load();
    } catch (e) {
      setModalMsg(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(user: AdminUserRow) {
    const label = displayName(user);
    if (
      !window.confirm(
        `Permanently delete ${label}? Auth sessions will be removed. Case rows may remain orphaned.`
      )
    ) {
      return;
    }
    if (!window.confirm("This cannot be undone. Delete user?")) return;
    setBusy(true);
    setModalMsg(null);
    try {
      await adminApi.deleteUser(user.id);
      closeUserModal();
      setMsg(`Deleted ${label}.`);
      await load();
    } catch (e) {
      setModalMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminWorkspace
      badge="Auth"
      title="Users"
      description={
        loading
          ? "Loading users…"
          : total === 0
            ? "No users"
            : `Showing ${rangeStart}–${rangeEnd} of ${total}${
                roleFilter !== "all" ? ` · ${ROLE_LABELS[roleFilter] ?? roleFilter}` : ""
              }`
      }
      sidebarHeader={<p className="text-xs font-semibold uppercase tracking-wider text-white/45">Users</p>}
      sidebar={
        <>
          <AdminNavItem
            dashed
            title="Add user"
            onClick={openCreateModal}
            meta={<Plus className="h-3.5 w-3.5" />}
          />
          <p className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            Filters
          </p>
          {ROLE_FILTERS.map((f) => (
            <AdminNavItem
              key={f.id}
              active={roleFilter === f.id}
              onClick={() => setRoleFilter(f.id)}
              title={f.label}
            />
          ))}
        </>
      }
      sidebarFooter={
        <AdminSidebarSearch
          value={search}
          onChange={setSearch}
          placeholder="Email, mobile, name, id…"
        />
      }
    >
      <AdminMainPanel>
        <AdminToolbar>
          <button
            type="button"
            className={cn(adminBtnSecondary, "h-8 gap-1 px-2.5 text-xs")}
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          <span className="text-xs text-white/45">
            Page {currentPage} of {pageCount}
          </span>
          <button
            type="button"
            className={cn(adminBtnSecondary, "h-8 gap-1 px-2.5 text-xs")}
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(adminBtnSecondary, "h-8 gap-1 px-2.5 text-xs")}
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <div className="ml-auto text-xs text-white/40">{PAGE_SIZE} per page</div>
        </AdminToolbar>

        {msg && (
          <p className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-300">
            {msg}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-white/10 bg-black/40 text-xs uppercase tracking-wide text-white/45">
              <tr>
                <th className="w-12 px-3 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Display name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Mobile</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Must reset</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-white/40">
                    Loading users…
                  </td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-white/40">
                    No users match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                users.map((u, index) => {
                  const isSelected = selected?.id === u.id;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => openUser(u)}
                      className={cn(
                        "cursor-pointer border-b border-white/5 transition last:border-0",
                        isSelected ? "bg-blue-600/15" : "hover:bg-white/5"
                      )}
                    >
                      <td className="px-3 py-3 text-center text-xs text-white/35">
                        {offset + index + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{displayName(u)}</td>
                      <td className="px-4 py-3 text-white/70">{u.email || "—"}</td>
                      <td className="px-4 py-3 text-white/70">{u.mobile || "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
                            roleBadgeClass(String(u.role || ""))
                          )}
                        >
                          {ROLE_LABELS[String(u.role)] ?? String(u.role || "—")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                            statusBadgeClass(String(u.status || ""))
                          )}
                        >
                          {String(u.status || "—")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {u.password_reset_required ? (
                          <span className="text-amber-300">Yes</span>
                        ) : (
                          <span className="text-white/35">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/50">{formatDate(u.created_at)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {createOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={closeCreateModal}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-create-title"
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-[#141414] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 id="user-create-title" className="text-lg font-semibold text-white">
                    Add user
                  </h3>
                  <p className="text-sm text-white/50">
                    Creates an active account that can sign in immediately.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {createMsg && (
                <p className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {createMsg}
                </p>
              )}

              <div className="space-y-3">
                <div>
                  <label htmlFor="create-email" className="mb-1 block text-xs font-medium text-white/50">
                    Email
                  </label>
                  <input
                    id="create-email"
                    type="email"
                    autoComplete="off"
                    value={createForm.email}
                    onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="user@example.com"
                    className={adminInput}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label htmlFor="create-mobile" className="mb-1 block text-xs font-medium text-white/50">
                    Mobile
                  </label>
                  <input
                    id="create-mobile"
                    type="tel"
                    autoComplete="off"
                    value={createForm.mobile}
                    onChange={(e) => setCreateForm((f) => ({ ...f, mobile: e.target.value }))}
                    placeholder="Optional if email is set"
                    className={adminInput}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label
                    htmlFor="create-display-name"
                    className="mb-1 block text-xs font-medium text-white/50"
                  >
                    Display name
                  </label>
                  <input
                    id="create-display-name"
                    type="text"
                    autoComplete="off"
                    value={createForm.display_name}
                    onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))}
                    placeholder="Optional"
                    className={adminInput}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label htmlFor="create-role" className="mb-1 block text-xs font-medium text-white/50">
                    Role
                  </label>
                  <select
                    id="create-role"
                    value={createForm.role}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, role: e.target.value as CreateRole }))
                    }
                    className={cn(adminSelect, "w-full")}
                    disabled={busy}
                  >
                    {CREATE_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="create-password" className="mb-1 block text-xs font-medium text-white/50">
                    Password
                  </label>
                  <PasswordInput
                    id="create-password"
                    variant="admin"
                    autoComplete="new-password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="At least 8 characters"
                    inputClassName={adminInput}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label
                    htmlFor="create-confirm-password"
                    className="mb-1 block text-xs font-medium text-white/50"
                  >
                    Confirm password
                  </label>
                  <PasswordInput
                    id="create-confirm-password"
                    variant="admin"
                    autoComplete="new-password"
                    value={createForm.confirm_password}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, confirm_password: e.target.value }))
                    }
                    placeholder="Repeat password"
                    inputClassName={adminInput}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  className={cn(adminBtnSecondary, "flex-1")}
                  disabled={busy}
                  onClick={closeCreateModal}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={cn(adminBtnPrimary, "flex-1 gap-2")}
                  disabled={busy}
                  onClick={() => void handleCreateUser()}
                >
                  {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create user
                </button>
              </div>
            </div>
          </div>
        )}

        {selected && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={closeUserModal}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-manage-title"
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-[#141414] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 id="user-manage-title" className="text-lg font-semibold text-white">
                    {displayName(selected)}
                  </h3>
                  <p className="text-sm text-white/50">{selected.email || selected.mobile || selected.id}</p>
                </div>
                <button
                  type="button"
                  onClick={closeUserModal}
                  className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {modalMsg && (
                <p className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-300">
                  {modalMsg}
                </p>
              )}

              {resetCode && (
                <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-950/30 p-4 text-sm">
                  <p className="font-mono text-2xl font-semibold tracking-wider text-emerald-300">
                    {resetCode.code}
                  </p>
                  {resetCode.expires_at && (
                    <p className="mt-2 text-xs text-white/40">Expires: {formatDate(resetCode.expires_at)}</p>
                  )}
                </div>
              )}

              <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm text-white/80">
                <dt className="text-white/45">Role</dt>
                <dd>{ROLE_LABELS[String(selected.role)] ?? String(selected.role || "—")}</dd>
                <dt className="text-white/45">Status</dt>
                <dd className="capitalize">{String(selected.status || "—")}</dd>
                <dt className="text-white/45">Must reset</dt>
                <dd>{selected.password_reset_required ? "Yes" : "No"}</dd>
                <dt className="text-white/45">Failed logins</dt>
                <dd>{selected.failed_login_attempts ?? 0}</dd>
                <dt className="text-white/45">Locked until</dt>
                <dd>{formatDate(selected.locked_until)}</dd>
                <dt className="text-white/45">Created</dt>
                <dd>{formatDate(selected.created_at)}</dd>
                <dt className="text-white/45">ID</dt>
                <dd className="break-all font-mono text-xs text-white/50">{selected.id}</dd>
              </dl>

              <div className="mb-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(
                    selected.status === "disabled" ? adminBtnPrimary : adminBtnSecondary,
                    "gap-1.5 text-xs"
                  )}
                  disabled={busy}
                  onClick={() => void handleToggleRestrict(selected)}
                >
                  {selected.status === "disabled" ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldBan className="h-3.5 w-3.5" />
                  )}
                  {selected.status === "disabled" ? "Unrestrict" : "Restrict"}
                </button>
                <button
                  type="button"
                  className={cn(adminBtnDanger, "gap-1.5 text-xs")}
                  disabled={busy}
                  onClick={() => void handleDelete(selected)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>

              <div className="mb-5 space-y-3 border-t border-white/10 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/45">
                  Set password
                </p>
                <div>
                  <label htmlFor="manual-password" className="mb-1 block text-xs font-medium text-white/50">
                    New password
                  </label>
                  <PasswordInput
                    id="manual-password"
                    variant="admin"
                    autoComplete="new-password"
                    value={manualPassword}
                    onChange={(e) => setManualPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    inputClassName={adminInput}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-manual-password"
                    className="mb-1 block text-xs font-medium text-white/50"
                  >
                    Confirm password
                  </label>
                  <PasswordInput
                    id="confirm-manual-password"
                    variant="admin"
                    autoComplete="new-password"
                    value={confirmManualPassword}
                    onChange={(e) => setConfirmManualPassword(e.target.value)}
                    placeholder="Repeat password"
                    inputClassName={adminInput}
                    disabled={busy}
                  />
                </div>
                <button
                  type="button"
                  className={cn(adminBtnPrimary, "w-full gap-2")}
                  disabled={busy || !manualPassword || !confirmManualPassword}
                  onClick={() => void handleManualReset(selected.id)}
                >
                  {busy ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Reset manually
                </button>
                <p className="text-xs text-white/45">
                  Sets the password above and revokes sessions. Share it with the user directly.
                </p>
              </div>

              <div className="space-y-3 border-t border-white/10 pt-5">
                <button
                  type="button"
                  className={cn(adminBtnSecondary, "w-full gap-2")}
                  disabled={busy}
                  onClick={() => void handleGenerateResetCode(selected)}
                >
                  {busy ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Generate reset code
                </button>
                <p className="text-xs text-white/45">
                  Issues a one-time code the user can use at the reset-password flow (for imported
                  accounts without a local password).
                </p>
              </div>
            </div>
          </div>
        )}
      </AdminMainPanel>
    </AdminWorkspace>
  );
}
