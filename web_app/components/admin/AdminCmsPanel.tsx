"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { AdminTabPage, AdminNavItem } from "@/components/admin/AdminPageLayout";
import { AdminTextEditorModal } from "@/components/admin/AdminTextEditorModal";
import {
  AdminErrorBanner,
  AdminLoading,
  adminBtnDanger,
  adminBtnPrimary,
  adminBtnSecondary,
  adminCard,
  adminInput,
  adminSelect,
} from "@/components/admin/admin-ui";
import { adminApi } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

type CmsSubtab = "file-a-case" | "legal-rights";

type CaseFilingRow = {
  id: string;
  title: string;
  category: string;
  description: string;
  steps: unknown;
  required_docs: unknown;
  estimated_time: string | null;
  authority: string | null;
  action_prompt: string;
  sort_order: number;
  active: boolean;
};

type LegalRightRow = {
  id: string;
  title: string;
  description: string;
  action_prompt: string;
  category: string | null;
  icon_key: string | null;
  sort_order: number;
  active: boolean;
};

const EMPTY_FORM: CaseFilingRow = {
  id: "",
  title: "",
  category: "",
  description: "",
  steps: [],
  required_docs: [],
  estimated_time: "",
  authority: "",
  action_prompt: "",
  sort_order: 100,
  active: true,
};

const EMPTY_RIGHT: LegalRightRow = {
  id: "",
  title: "",
  description: "",
  action_prompt: "",
  category: "",
  icon_key: "",
  sort_order: 100,
  active: true,
};

function toLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    const lines = value.map((v) => String(v ?? ""));
    return lines.length ? lines : [""];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const lines = parsed.map((v) => String(v ?? ""));
        return lines.length ? lines : [""];
      }
    } catch {
      const lines = value.split("\n");
      return lines.length ? lines : [""];
    }
  }
  return [""];
}

function cleanLines(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

function LineListEditor({
  label,
  items,
  onChange,
  placeholder,
  numbered,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  numbered?: boolean;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const updateAt = (index: number, value: string) => {
    onChange(items.map((item, i) => (i === index ? value : item)));
  };

  const removeAt = (index: number) => {
    if (items.length <= 1) {
      onChange([""]);
      return;
    }
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    const next = [...items, ""];
    onChange(next);
    setEditingIndex(next.length - 1);
  };

  const openEditor = (index: number) => setEditingIndex(index);
  const closeEditor = () => setEditingIndex(null);

  return (
    <div className="block text-xs text-white/50">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="text-[11px] text-white/30">{cleanLines(items).length} item(s)</span>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            {numbered ? (
              <span className="mt-2.5 w-5 shrink-0 text-right font-mono text-[11px] text-white/30">
                {index + 1}.
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => openEditor(index)}
              className={cn(
                adminInput,
                "min-w-0 flex-1 cursor-pointer text-left hover:border-white/20 hover:bg-white/[0.03]"
              )}
              title="Click to edit in floating editor"
            >
              <span className={cn("block truncate", !item && "text-white/30")}>
                {item || placeholder || `Item ${index + 1}`}
              </span>
            </button>
            <button
              type="button"
              className={cn(adminBtnSecondary, "shrink-0 px-2.5")}
              onClick={() => removeAt(index)}
              title="Remove"
              aria-label={`Remove ${label} item ${index + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={cn(adminBtnSecondary, "mt-2 w-full text-xs")} onClick={addItem}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add {numbered ? "step" : "item"}
      </button>

      {editingIndex !== null && editingIndex < items.length && (
        <AdminTextEditorModal
          title={`Edit ${numbered ? "step" : "item"} ${editingIndex + 1}`}
          column={label}
          value={items[editingIndex] || ""}
          onClose={closeEditor}
          onSave={(value) => updateAt(editingIndex, value)}
        />
      )}
    </div>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function FileACaseCms() {
  const [rows, setRows] = useState<CaseFilingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<CaseFilingRow>(EMPTY_FORM);
  const [steps, setSteps] = useState<string[]>([""]);
  const [docs, setDocs] = useState<string[]>([""]);

  const applyRow = useCallback((row: CaseFilingRow) => {
    setIsNew(false);
    setSelectedId(row.id);
    setForm({
      ...row,
      estimated_time: row.estimated_time || "",
      authority: row.authority || "",
      action_prompt: row.action_prompt || "",
    });
    setSteps(toLines(row.steps));
    setDocs(toLines(row.required_docs));
  }, []);

  const load = useCallback(async (preferId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.tableRows("case_filing_templates", {
        limit: 200,
        orderBy: "sort_order",
        orderDir: "asc",
      });
      const list = (res.rows || []) as CaseFilingRow[];
      setRows(list);
      const match = preferId ? list.find((r) => r.id === preferId) : null;
      if (match) {
        applyRow(match);
      } else if (!preferId && list[0]) {
        applyRow(list[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [applyRow]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectRow = (row: CaseFilingRow) => {
    applyRow(row);
  };

  const startNew = () => {
    setIsNew(true);
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setSteps([""]);
    setDocs([""]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const id = (form.id || slugify(form.title)).trim();
      if (!id || !form.title.trim()) {
        throw new Error("Id and title are required");
      }
      const values = {
        id,
        title: form.title.trim(),
        category: form.category.trim() || "General",
        description: form.description.trim(),
        steps: cleanLines(steps),
        required_docs: cleanLines(docs),
        estimated_time: form.estimated_time?.trim() || null,
        authority: form.authority?.trim() || null,
        action_prompt: form.action_prompt.trim(),
        sort_order: Number(form.sort_order) || 100,
        active: Boolean(form.active),
      };

      if (isNew) {
        await adminApi.insertRow("case_filing_templates", values);
      } else {
        await adminApi.updateRow("case_filing_templates", { id: selectedId || id }, values);
      }
      await load(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId || isNew) return;
    if (!confirm(`Delete template “${selectedId}”?`)) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.deleteRow("case_filing_templates", { id: selectedId });
      setSelectedId(null);
      setIsNew(false);
      setForm(EMPTY_FORM);
      setSteps([""]);
      setDocs([""]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading && rows.length === 0) {
    return <AdminLoading label="Loading file-a-case templates…" />;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <aside className={cn(adminCard, "flex w-[260px] shrink-0 flex-col overflow-hidden p-3")}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">Guides</p>
          <button type="button" className={adminBtnSecondary} onClick={startNew}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New
          </button>
        </div>
        <div className="admin-no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto">
          {rows.map((row) => (
            <AdminNavItem
              key={row.id}
              active={!isNew && selectedId === row.id}
              onClick={() => selectRow(row)}
              title={row.title}
              subtitle={`${row.category}${row.active ? "" : " · inactive"}`}
            />
          ))}
          {rows.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-white/35">No templates yet.</p>
          )}
        </div>
      </aside>

      <div className={cn(adminCard, "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden")}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {isNew ? "New guide" : form.title || selectedId || "Edit guide"}
            </p>
            <p className="truncate text-[11px] text-white/35">
              {isNew ? "Create a filing guide and system prompt" : "Changes apply to the case composer on /home and /cases immediately"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {!isNew && selectedId && (
              <button type="button" className={adminBtnDanger} disabled={saving} onClick={() => void remove()}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete
              </button>
            )}
            <button type="button" className={adminBtnPrimary} disabled={saving} onClick={() => void save()}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {error && (
            <div className="mb-4">
              <AdminErrorBanner message={error} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/50">
              Id
              <input
                className={`${adminInput} mt-1`}
                value={form.id}
                disabled={!isNew}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder="file-fir"
              />
            </label>
            <label className="block text-xs text-white/50">
              Category
              <input
                className={`${adminInput} mt-1`}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Criminal"
              />
            </label>
            <label className="block text-xs text-white/50 sm:col-span-2">
              Title
              <input
                className={`${adminInput} mt-1`}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="File an FIR"
              />
            </label>
            <label className="block text-xs text-white/50 sm:col-span-2">
              Description
              <textarea
                className={`${adminInput} mt-1 min-h-[72px] resize-y`}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-white/50">
              Estimated time
              <input
                className={`${adminInput} mt-1`}
                value={form.estimated_time || ""}
                onChange={(e) => setForm((f) => ({ ...f, estimated_time: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-white/50">
              Authority
              <input
                className={`${adminInput} mt-1`}
                value={form.authority || ""}
                onChange={(e) => setForm((f) => ({ ...f, authority: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-white/50">
              Sort order
              <input
                type="number"
                className={`${adminInput} mt-1`}
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
              />
            </label>
            <label className="block text-xs text-white/50">
              Active
              <select
                className={`${adminSelect} mt-1 w-full`}
                value={form.active ? "true" : "false"}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "true" }))}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block text-xs text-white/50">
            System prompt
            <span className="mt-0.5 block text-[11px] text-white/30">
              Sent as the first message when the user picks a guided template on the home case composer or in chat.
            </span>
            <textarea
              className={`${adminInput} mt-1 min-h-[160px] max-h-[min(50vh,420px)] resize-y overflow-y-auto font-mono text-[12px] leading-relaxed`}
              value={form.action_prompt}
              onChange={(e) => setForm((f) => ({ ...f, action_prompt: e.target.value }))}
              placeholder="Help me file an FIR in India…"
            />
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <LineListEditor
              label="Steps"
              items={steps}
              onChange={setSteps}
              placeholder="e.g. Visit the nearest police station"
              numbered
            />
            <LineListEditor
              label="Required documents"
              items={docs}
              onChange={setDocs}
              placeholder="e.g. Aadhaar card / ID proof"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegalRightsCms() {
  const [rows, setRows] = useState<LegalRightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<LegalRightRow>(EMPTY_RIGHT);

  const applyRow = useCallback((row: LegalRightRow) => {
    setIsNew(false);
    setSelectedId(row.id);
    setForm({
      ...row,
      category: row.category || "",
      icon_key: row.icon_key || "",
      action_prompt: row.action_prompt || "",
    });
  }, []);

  const load = useCallback(
    async (preferId?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.tableRows("legal_rights", {
          limit: 200,
          orderBy: "sort_order",
          orderDir: "asc",
        });
        const list = (res.rows || []) as LegalRightRow[];
        setRows(list);
        const match = preferId ? list.find((r) => r.id === preferId) : null;
        if (match) {
          applyRow(match);
        } else if (!preferId && list[0]) {
          applyRow(list[0]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load legal rights");
      } finally {
        setLoading(false);
      }
    },
    [applyRow]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = () => {
    setIsNew(true);
    setSelectedId(null);
    setForm(EMPTY_RIGHT);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const id = (form.id || slugify(form.title)).trim();
      if (!id || !form.title.trim()) {
        throw new Error("Id and title are required");
      }
      if (!form.action_prompt.trim()) {
        throw new Error("Action prompt is required");
      }
      const values = {
        id,
        title: form.title.trim(),
        description: form.description.trim(),
        action_prompt: form.action_prompt.trim(),
        category: form.category?.trim() || null,
        icon_key: form.icon_key?.trim() || null,
        sort_order: Number(form.sort_order) || 100,
        active: Boolean(form.active),
      };

      if (isNew) {
        await adminApi.insertRow("legal_rights", values);
      } else {
        await adminApi.updateRow("legal_rights", { id: selectedId || id }, values);
      }
      await load(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId || isNew) return;
    if (!confirm(`Delete legal right “${selectedId}”?`)) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.deleteRow("legal_rights", { id: selectedId });
      setSelectedId(null);
      setIsNew(false);
      setForm(EMPTY_RIGHT);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading && rows.length === 0) {
    return <AdminLoading label="Loading legal rights…" />;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <aside className={cn(adminCard, "flex w-[260px] shrink-0 flex-col overflow-hidden p-3")}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">Rights</p>
          <button type="button" className={adminBtnSecondary} onClick={startNew}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New
          </button>
        </div>
        <div className="admin-no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto">
          {rows.map((row) => (
            <AdminNavItem
              key={row.id}
              active={!isNew && selectedId === row.id}
              onClick={() => applyRow(row)}
              title={row.title}
              subtitle={`${row.category || "General"}${row.active ? "" : " · inactive"}`}
            />
          ))}
          {rows.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-white/35">No legal rights yet.</p>
          )}
        </div>
      </aside>

      <div className={cn(adminCard, "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden")}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {isNew ? "New legal right" : form.title || selectedId || "Edit legal right"}
            </p>
            <p className="truncate text-[11px] text-white/35">
              {isNew
                ? "Create a card and chat prompt for /legal-rights"
                : "Changes apply to /legal-rights immediately"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {!isNew && selectedId && (
              <button type="button" className={adminBtnDanger} disabled={saving} onClick={() => void remove()}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete
              </button>
            )}
            <button type="button" className={adminBtnPrimary} disabled={saving} onClick={() => void save()}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {error && (
            <div className="mb-4">
              <AdminErrorBanner message={error} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/50">
              Id
              <input
                className={`${adminInput} mt-1`}
                value={form.id}
                disabled={!isNew}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder="police-fir-rights"
              />
            </label>
            <label className="block text-xs text-white/50">
              Category
              <input
                className={`${adminInput} mt-1`}
                value={form.category || ""}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Criminal Law"
              />
            </label>
            <label className="block text-xs text-white/50 sm:col-span-2">
              Title
              <input
                className={`${adminInput} mt-1`}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Police & FIR Rights"
              />
            </label>
            <label className="block text-xs text-white/50 sm:col-span-2">
              Description
              <textarea
                className={`${adminInput} mt-1 min-h-[88px] resize-y`}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Short card copy shown on /legal-rights"
              />
            </label>
            <label className="block text-xs text-white/50">
              Icon key
              <input
                className={`${adminInput} mt-1`}
                value={form.icon_key || ""}
                onChange={(e) => setForm((f) => ({ ...f, icon_key: e.target.value }))}
                placeholder="shield / alert / users / scale"
              />
              <span className="mt-0.5 block text-[11px] text-white/30">
                Optional hint for the frontend icon map (id is also used as fallback).
              </span>
            </label>
            <label className="block text-xs text-white/50">
              Sort order
              <input
                type="number"
                className={`${adminInput} mt-1`}
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
              />
            </label>
            <label className="block text-xs text-white/50">
              Active
              <select
                className={`${adminSelect} mt-1 w-full`}
                value={form.active ? "true" : "false"}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "true" }))}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block text-xs text-white/50">
            Action prompt
            <span className="mt-0.5 block text-[11px] text-white/30">
              Sent as the first chat message when the user clicks a card on /legal-rights.
            </span>
            <textarea
              className={`${adminInput} mt-1 min-h-[160px] max-h-[min(50vh,420px)] resize-y overflow-y-auto font-mono text-[12px] leading-relaxed`}
              value={form.action_prompt}
              onChange={(e) => setForm((f) => ({ ...f, action_prompt: e.target.value }))}
              placeholder="Explain my rights when filing an FIR in India…"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function CmsSubtabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-3 py-1.5 text-sm transition",
        active
          ? "bg-emerald-600/20 text-white shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)]"
          : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
      )}
    >
      {children}
    </button>
  );
}

export function AdminCmsPanel() {
  const [subtab, setSubtab] = useState<CmsSubtab>("file-a-case");

  return (
    <AdminTabPage
      badge="CMS"
      title="Content"
      description="Manage public site guides and prompts."
      className="!flex !flex-col !overflow-hidden !p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-2 border-b border-white/[0.07] px-5 py-3">
          <CmsSubtabButton active={subtab === "file-a-case"} onClick={() => setSubtab("file-a-case")}>
            File a Case
          </CmsSubtabButton>
          <CmsSubtabButton active={subtab === "legal-rights"} onClick={() => setSubtab("legal-rights")}>
            Legal Rights
          </CmsSubtabButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
          {subtab === "file-a-case" && <FileACaseCms />}
          {subtab === "legal-rights" && <LegalRightsCms />}
        </div>
      </div>
    </AdminTabPage>
  );
}
