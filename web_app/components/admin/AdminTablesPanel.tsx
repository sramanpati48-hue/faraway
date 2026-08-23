"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminJsonEditorModal } from "@/components/admin/AdminJsonEditorModal";
import { AdminTextEditorModal } from "@/components/admin/AdminTextEditorModal";
import {
  AdminNavItem,
  AdminSidebarRefreshButton,
  AdminSidebarSearch,
  AdminToolbar,
  AdminWorkspace,
  adminTableScroll,
} from "@/components/admin/AdminPageLayout";
import { adminBtnSecondary } from "@/components/admin/admin-ui";
import { adminApi } from "@/lib/adminApi";

const PAGE_SIZE = 50;
const LONG_TEXT_THRESHOLD = 72;
const TIMESTAMP_ORDER_CANDIDATES = ["created_at", "updated_at", "inserted_at", "modified_at"];

type AdminColumnInfo = {
  name: string;
  data_type: string;
  udt_name: string;
  is_nullable?: boolean;
  column_default?: string | null;
  is_primary_key?: boolean;
};

type AdminTableSchema = {
  table: string;
  columns: AdminColumnInfo[];
  primary_key: string[];
};

type AdminTableInfo = { name: string; row_count: number | null };

function resolveOrderBy(schema: AdminTableSchema): string {
  const byLower = new Map(schema.columns.map((c) => [c.name.toLowerCase(), c.name]));
  for (const candidate of TIMESTAMP_ORDER_CANDIDATES) {
    const match = byLower.get(candidate);
    if (match) return match;
  }
  for (const col of schema.columns) {
    const dt = col.data_type.toLowerCase();
    if (dt.includes("timestamp") || dt === "date") return col.name;
  }
  if (schema.primary_key.length === 1) {
    const pkName = schema.primary_key[0];
    const pkCol = schema.columns.find((c) => c.name === pkName);
    if (pkCol) {
      const dt = pkCol.data_type.toLowerCase();
      const udt = pkCol.udt_name.toLowerCase();
      if (dt.includes("int") || udt === "uuid" || pkName.toLowerCase() === "id") return pkName;
    }
  }
  return schema.primary_key[0] ?? schema.columns[0]?.name ?? "id";
}

function isJsonColumn(col: AdminColumnInfo | undefined): boolean {
  if (!col) return false;
  const dt = col.data_type.toLowerCase();
  return dt.includes("json") || col.udt_name === "jsonb";
}

function isTextColumn(col: AdminColumnInfo | undefined): boolean {
  if (!col) return false;
  const dt = col.data_type.toLowerCase();
  const udt = col.udt_name.toLowerCase();
  return dt === "text" || udt === "text";
}

function shouldUseTextModal(col: AdminColumnInfo | undefined, value: unknown): boolean {
  if (!col || isJsonColumn(col)) return false;
  if (isTextColumn(col)) return true;
  if (typeof value === "string" && value.length > LONG_TEXT_THRESHOLD) return true;
  return false;
}

function cellDisplay(value: unknown, longPreview = false): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") {
    const s = JSON.stringify(value);
    if (longPreview && s.length > LONG_TEXT_THRESHOLD) return `${s.slice(0, LONG_TEXT_THRESHOLD - 3)}…`;
    return s;
  }
  const s = String(value);
  if (longPreview && s.length > LONG_TEXT_THRESHOLD) return `${s.slice(0, LONG_TEXT_THRESHOLD - 3)}…`;
  return s;
}

function rowMatchesSearch(row: Record<string, unknown>, query: string, searchColumns: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return searchColumns.some((col) => cellDisplay(row[col]).toLowerCase().includes(q));
}

function parseInputValue(raw: string, col: AdminColumnInfo): unknown {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toUpperCase() === "NULL") {
    return null;
  }
  const dt = col.data_type.toLowerCase();
  if (dt.includes("bool")) return trimmed === "true" || trimmed === "t" || trimmed === "1";
  if (dt.includes("int") || dt === "smallint" || dt === "bigint" || dt === "serial") {
    const n = Number(trimmed);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${col.name}`);
    return n;
  }
  if (dt.includes("json")) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function sqlLiteral(value: unknown, col?: AdminColumnInfo): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "object") {
    const json = JSON.stringify(value).replace(/'/g, "''");
    const udt = col?.udt_name?.toLowerCase() ?? "";
    const dt = col?.data_type?.toLowerCase() ?? "";
    if (udt === "jsonb" || udt === "json" || dt.includes("json")) return `'${json}'::jsonb`;
    if (dt.includes("array") || udt.endsWith("[]")) {
      if (!Array.isArray(value)) return `'${json}'`;
      if (value.length === 0) return "ARRAY[]::text[]";
      return `ARRAY[${value.map((v) => sqlLiteral(v)).join(", ")}]`;
    }
    return `'${json}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function rowsToInsertSql(
  table: string,
  selectedRows: Record<string, unknown>[],
  schema: AdminTableSchema
): string {
  const colNames = schema.columns.map((c) => c.name);
  const schemaByCol = new Map(schema.columns.map((c) => [c.name, c]));
  return selectedRows
    .map((row) => {
      const cols = colNames.filter((name) => name in row);
      const values = cols.map((name) => sqlLiteral(row[name], schemaByCol.get(name)));
      const quotedCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
      return `INSERT INTO "${table.replace(/"/g, '""')}" (${quotedCols}) VALUES (${values.join(", ")});`;
    })
    .join("\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

type EditingCell = { rowIndex: number; column: string; value: string };
type JsonEditingCell = { rowIndex: number; column: string; value: unknown };
type TextEditingCell = { rowIndex: number; column: string; value: string };

export function AdminTablesPanel() {
  const [tables, setTables] = useState<AdminTableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [schema, setSchema] = useState<AdminTableSchema | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [jsonEditing, setJsonEditing] = useState<JsonEditingCell | null>(null);
  const [textEditing, setTextEditing] = useState<TextEditingCell | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [showInsert, setShowInsert] = useState(false);
  const [insertDraft, setInsertDraft] = useState<Record<string, string>>({});
  const [tableSearch, setTableSearch] = useState("");
  const [columnSearch, setColumnSearch] = useState("");
  const [rowSearch, setRowSearch] = useState("");
  const [tablesLoading, setTablesLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const schemaByCol = useMemo(() => {
    const m = new Map<string, AdminColumnInfo>();
    schema?.columns.forEach((c) => m.set(c.name, c));
    return m;
  }, [schema]);

  const primaryKeySet = useMemo(() => new Set(schema?.primary_key ?? []), [schema]);

  const visibleColumns = useMemo(() => {
    const q = columnSearch.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => primaryKeySet.has(c) || c.toLowerCase().includes(q));
  }, [columns, columnSearch, primaryKeySet]);

  const displayedRows = useMemo(
    () =>
      rows
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row }) => rowMatchesSearch(row, rowSearch, columns)),
    [rows, rowSearch, columns]
  );

  const loadTables = useCallback(async (): Promise<string | null> => {
    setTablesLoading(true);
    setError(null);
    try {
      const res = await adminApi.tables();
      setTables(res.tables || []);
      let resolved: string | null = null;
      setSelectedTable((current) => {
        if (current && (res.tables || []).some((t) => t.name === current)) {
          resolved = current;
          return current;
        }
        resolved = res.tables?.[0]?.name ?? null;
        return resolved;
      });
      return resolved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list tables");
      throw err;
    } finally {
      setTablesLoading(false);
    }
  }, []);

  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, tableSearch]);

  const loadTableData = useCallback(
    async (tableOverride?: string) => {
      const table = tableOverride ?? selectedTable;
      if (!table) return;
      setLoading(true);
      setError(null);
      try {
        const schemaRes = (await adminApi.tableSchema(table)) as AdminTableSchema;
        const orderBy = resolveOrderBy(schemaRes);
        const rowsRes = await adminApi.tableRows(table, {
          offset,
          limit: PAGE_SIZE,
          order_by: orderBy,
          order_dir: "desc",
        });
        setSchema(schemaRes);
        setColumns(rowsRes.columns || []);
        setRows(rowsRes.rows || []);
        setTotal(rowsRes.total || 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load table");
      } finally {
        setLoading(false);
      }
    },
    [selectedTable, offset]
  );

  const handleRefreshTables = useCallback(async () => {
    try {
      const table = await loadTables();
      if (table) await loadTableData(table);
    } catch {
      /* loadTables sets error */
    }
  }, [loadTables, loadTableData]);

  useEffect(() => {
    loadTables().catch(() => {});
  }, [loadTables]);

  useEffect(() => {
    if (selectedTable) {
      setOffset(0);
      setSelectedRowIndices(new Set());
      setEditing(null);
      setColumnSearch("");
      setRowSearch("");
    }
  }, [selectedTable]);

  useEffect(() => {
    setSelectedRowIndices(new Set());
  }, [offset]);

  useEffect(() => {
    if (selectedTable) loadTableData();
  }, [selectedTable, offset, loadTableData]);

  function startEdit(rowIndex: number, column: string) {
    const colMeta = schemaByCol.get(column);
    if (colMeta?.is_primary_key) return;
    const val = rows[rowIndex]?.[column];
    if (isJsonColumn(colMeta)) {
      setJsonEditing({ rowIndex, column, value: val ?? null });
      return;
    }
    if (shouldUseTextModal(colMeta, val)) {
      setTextEditing({
        rowIndex,
        column,
        value: val === null || val === undefined ? "" : String(val),
      });
      return;
    }
    setEditing({
      rowIndex,
      column,
      value: val === null || val === undefined ? "" : String(val),
    });
  }

  async function commitTextEdit(newValue: string) {
    if (!textEditing || !schema || !selectedTable) return;
    const colMeta = schemaByCol.get(textEditing.column);
    if (!colMeta) return;
    const row = rows[textEditing.rowIndex];
    if (!row) return;
    const pk: Record<string, unknown> = {};
    for (const k of schema.primary_key) {
      pk[k] = row[k];
    }
    try {
      const parsed = parseInputValue(newValue, colMeta);
      await adminApi.updateRow(selectedTable, pk, { [textEditing.column]: parsed });
      setTextEditing(null);
      await loadTableData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function commitJsonEdit(parsed: unknown) {
    if (!jsonEditing || !schema || !selectedTable) return;
    const row = rows[jsonEditing.rowIndex];
    if (!row) return;
    const pk: Record<string, unknown> = {};
    for (const k of schema.primary_key) {
      pk[k] = row[k];
    }
    try {
      await adminApi.updateRow(selectedTable, pk, { [jsonEditing.column]: parsed });
      setJsonEditing(null);
      await loadTableData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function commitEdit() {
    if (!editing || !schema || !selectedTable) return;
    const colMeta = schemaByCol.get(editing.column);
    if (!colMeta) return;
    const row = rows[editing.rowIndex];
    if (!row) return;

    try {
      const newValue = parseInputValue(editing.value, colMeta);
      const pk: Record<string, unknown> = {};
      for (const k of schema.primary_key) {
        pk[k] = row[k];
      }
      await adminApi.updateRow(selectedTable, pk, { [editing.column]: newValue });
      setEditing(null);
      await loadTableData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const selectedCount = selectedRowIndices.size;
  const allRowsSelected =
    displayedRows.length > 0 && displayedRows.every(({ rowIndex }) => selectedRowIndices.has(rowIndex));
  const someRowsSelected =
    displayedRows.some(({ rowIndex }) => selectedRowIndices.has(rowIndex)) && !allRowsSelected;

  function toggleRowSelection(rowIndex: number) {
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function toggleSelectAllRows() {
    const visibleIndices = displayedRows.map(({ rowIndex }) => rowIndex);
    if (allRowsSelected) {
      setSelectedRowIndices((prev) => {
        const next = new Set(prev);
        visibleIndices.forEach((i) => next.delete(i));
        return next;
      });
      return;
    }
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      visibleIndices.forEach((i) => next.add(i));
      return next;
    });
  }

  function getSelectedRows(): Record<string, unknown>[] {
    return Array.from(selectedRowIndices)
      .sort((a, b) => a - b)
      .map((i) => rows[i])
      .filter((r): r is Record<string, unknown> => Boolean(r));
  }

  async function handleCopyJson() {
    const selected = getSelectedRows();
    if (!selected.length) return;
    try {
      await copyTextToClipboard(JSON.stringify(selected.length === 1 ? selected[0] : selected, null, 2));
      setCopyFeedback(`Copied ${selected.length} row(s) as JSON`);
      window.setTimeout(() => setCopyFeedback(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    }
  }

  async function handleCopySql() {
    if (!schema || !selectedTable || selectedCount === 0) return;
    const selected = getSelectedRows();
    if (!selected.length) return;
    const sql = rowsToInsertSql(selectedTable, selected, schema);
    try {
      await copyTextToClipboard(sql);
      setCopyFeedback(`Copied ${selected.length} INSERT statement(s)`);
      window.setTimeout(() => setCopyFeedback(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    }
  }

  async function handleDelete() {
    if (!schema || !selectedTable || selectedCount === 0) return;
    const indices = Array.from(selectedRowIndices).sort((a, b) => a - b);
    const label =
      indices.length === 1
        ? "Delete this row? This cannot be undone."
        : `Delete ${indices.length} selected rows? This cannot be undone.`;
    if (!window.confirm(label)) return;

    try {
      for (const rowIndex of indices) {
        const row = rows[rowIndex];
        if (!row) continue;
        const pk: Record<string, unknown> = {};
        for (const k of schema.primary_key) {
          pk[k] = row[k];
        }
        await adminApi.deleteRow(selectedTable, pk);
      }
      setSelectedRowIndices(new Set());
      await loadTableData();
      await loadTables();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function openInsert() {
    if (!schema) return;
    const draft: Record<string, string> = {};
    for (const col of schema.columns) {
      if (!col.is_primary_key || col.column_default) {
        draft[col.name] = "";
      }
    }
    setInsertDraft(draft);
    setShowInsert(true);
  }

  async function handleInsert() {
    if (!schema || !selectedTable) return;
    const values: Record<string, unknown> = {};
    try {
      for (const [name, raw] of Object.entries(insertDraft)) {
        if (raw.trim() === "") continue;
        const col = schemaByCol.get(name);
        if (!col) continue;
        values[name] = parseInputValue(raw, col);
      }
      await adminApi.insertRow(selectedTable, values);
      setShowInsert(false);
      setInsertDraft({});
      await loadTableData();
      await loadTables();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Insert failed");
    }
  }

  return (
    <>
      <AdminWorkspace
        badge="Database"
        title="Tables"
        description={
          selectedTable
            ? `${selectedTable} · Page ${currentPage} of ${pageCount} (${total} rows)`
            : "Browse and edit Postgres tables"
        }
        sidebarWidth="w-56"
        sidebar={
          filteredTables.length > 0 ? (
            filteredTables.map((t) => (
              <AdminNavItem
                key={t.name}
                active={selectedTable === t.name}
                onClick={() => setSelectedTable(t.name)}
                title={t.name}
                meta={
                  t.row_count != null ? (
                    <span className="shrink-0 font-mono text-xs text-white/40">{t.row_count}</span>
                  ) : undefined
                }
              />
            ))
          ) : (
            <p className="px-2 py-4 text-center text-xs text-white/40">
              {tableSearch.trim() ? "No matching tables" : "No tables"}
            </p>
          )
        }
        sidebarFooter={
          <>
            <AdminSidebarSearch value={tableSearch} onChange={setTableSearch} placeholder="Search tables…" />
            <AdminSidebarRefreshButton
              label={tablesLoading ? "Fetching tables…" : "Refresh tables"}
              loading={tablesLoading || loading}
              onClick={() => handleRefreshTables()}
            />
          </>
        }
        toolbar={
          <AdminToolbar sticky>
            <button
              type="button"
              onClick={() => loadTableData()}
              disabled={loading || !selectedTable}
              className={adminBtnSecondary}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openInsert}
              disabled={!schema}
              className="rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-40"
            >
              Insert row
            </button>
            <button
              type="button"
              onClick={() => void handleCopyJson()}
              disabled={selectedCount === 0}
              className={adminBtnSecondary}
            >
              {selectedCount > 0 ? `Copy JSON (${selectedCount})` : "Copy JSON"}
            </button>
            <button
              type="button"
              onClick={() => void handleCopySql()}
              disabled={selectedCount === 0 || !schema}
              className={adminBtnSecondary}
            >
              {selectedCount > 0 ? `Copy SQL (${selectedCount})` : "Copy SQL"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={selectedCount === 0 || !schema?.primary_key.length}
              className="rounded-lg border border-red-500/30 bg-red-600/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-600/30 disabled:opacity-40"
            >
              {selectedCount > 0 ? `Delete selected (${selectedCount})` : "Delete selected"}
            </button>
            {copyFeedback && <span className="text-xs text-emerald-400/90">{copyFeedback}</span>}
            {selectedTable && columns.length > 0 && (
              <>
                <div className="w-full min-w-[200px] flex-1 basis-full sm:max-w-xs sm:basis-auto">
                  <AdminSidebarSearch value={rowSearch} onChange={setRowSearch} placeholder="Search rows…" />
                </div>
                <div className="w-full min-w-[200px] flex-1 basis-full sm:max-w-xs sm:basis-auto">
                  <AdminSidebarSearch
                    value={columnSearch}
                    onChange={setColumnSearch}
                    placeholder="Filter columns… (PK always shown)"
                  />
                </div>
              </>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
              <button
                type="button"
                disabled={offset === 0 || loading}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                className={adminBtnSecondary}
              >
                Prev
              </button>
              <span>
                Page {currentPage} / {pageCount}
              </span>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className={adminBtnSecondary}
              >
                Next
              </button>
            </div>
          </AdminToolbar>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {error && (
            <div className="mx-5 mb-3 mt-3 shrink-0 rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-2 text-sm text-red-300 md:mx-6">
              {error}
              <button type="button" className="ml-3 underline" onClick={() => setError(null)}>
                dismiss
              </button>
            </div>
          )}

          <div className={`${adminTableScroll} relative min-h-0 flex-1 px-5 md:px-6`}>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm">Loading…</div>
            )}
            {selectedTable && columns.length > 0 ? (
              <table className="w-full min-w-max border-collapse text-left text-sm">
                <thead className="sticky top-0 z-[1] bg-[#111]">
                  <tr>
                    <th className="w-10 border-b border-white/10 px-2 py-2">
                      <input
                        type="checkbox"
                        checked={allRowsSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someRowsSelected;
                        }}
                        onChange={toggleSelectAllRows}
                        disabled={displayedRows.length === 0}
                        title={allRowsSelected ? "Deselect all visible rows" : "Select all visible rows"}
                        className="h-3.5 w-3.5 rounded border-white/20 bg-black/60 text-blue-500 focus:ring-blue-500/40"
                      />
                    </th>
                    <th className="w-8 border-b border-white/10 px-2 py-2 text-xs font-normal text-white/35">#</th>
                    {visibleColumns.map((col) => {
                      const meta = schemaByCol.get(col);
                      return (
                        <th
                          key={col}
                          className="border-b border-white/10 px-3 py-2 font-mono text-xs font-medium text-white/80"
                          title={meta ? `${meta.data_type}${meta.is_primary_key ? " · PK" : ""}` : undefined}
                        >
                          <span>{col}</span>
                          {meta?.is_primary_key && <span className="ml-1 text-amber-400/80">PK</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map(({ row, rowIndex }) => {
                    const isSelected = selectedRowIndices.has(rowIndex);
                    return (
                      <tr
                        key={rowIndex}
                        onClick={() => toggleRowSelection(rowIndex)}
                        className={`cursor-pointer border-b border-white/5 ${
                          isSelected ? "bg-blue-600/15" : "hover:bg-white/[0.02]"
                        }`}
                      >
                        <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(rowIndex)}
                            className="h-3.5 w-3.5 rounded border-white/20 bg-black/60 text-blue-500 focus:ring-blue-500/40"
                            aria-label={`Select row ${offset + rowIndex + 1}`}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs text-white/30">{offset + rowIndex + 1}</td>
                        {visibleColumns.map((col) => {
                          const isEditing = editing?.rowIndex === rowIndex && editing.column === col;
                          const meta = schemaByCol.get(col);
                          const isPk = meta?.is_primary_key;
                          const isJson = isJsonColumn(meta);
                          const useTextModal = shouldUseTextModal(meta, row[col]);
                          const showLongPreview = isJson || useTextModal;
                          return (
                            <td
                              key={col}
                              className={`max-w-xs truncate border-r border-white/5 px-3 py-1.5 font-mono text-xs ${
                                (isJson || useTextModal) && !isPk ? "cursor-pointer text-blue-200/90" : ""
                              }`}
                              onDoubleClick={() => !isPk && startEdit(rowIndex, col)}
                              title={
                                isJson
                                  ? "Double-click to open JSON editor"
                                  : useTextModal
                                    ? "Double-click to open text editor"
                                    : undefined
                              }
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  className="w-full min-w-[8rem] rounded border border-blue-500/50 bg-black px-2 py-1"
                                  value={editing.value}
                                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEdit();
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                />
                              ) : (
                                <span
                                  className={
                                    row[col] === null || row[col] === undefined
                                      ? "italic text-white/30"
                                      : "text-white/90"
                                  }
                                >
                                  {cellDisplay(row[col], showLongPreview)}
                                  {isJson && row[col] != null && (
                                    <span className="ml-1 text-[10px] text-blue-400/80">JSON</span>
                                  )}
                                  {useTextModal && !isJson && row[col] != null && (
                                    <span className="ml-1 text-[10px] text-emerald-400/80">TEXT</span>
                                  )}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {displayedRows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={visibleColumns.length + 2} className="px-4 py-12 text-center text-white/40">
                        {rowSearch.trim() ? "No matching rows on this page" : "No rows"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full items-center justify-center text-white/40">Select a table</div>
            )}
          </div>

          <p className="shrink-0 border-t border-white/10 px-5 py-2 text-xs text-white/40 md:px-6">
            Select rows with checkboxes (or click a row). Use Copy JSON / Copy SQL in the toolbar, or Delete selected
            to remove rows. Filter columns by name — primary keys always stay visible. Double-click a cell to edit.
            JSON/JSONB columns open a prettified editor. Long text values open a full-screen text editor. Primary keys
            are read-only.
          </p>
        </div>
      </AdminWorkspace>

      {jsonEditing && selectedTable && (
        <AdminJsonEditorModal
          title={`${selectedTable} — row ${jsonEditing.rowIndex + 1}`}
          column={jsonEditing.column}
          value={jsonEditing.value}
          onClose={() => setJsonEditing(null)}
          onSave={commitJsonEdit}
        />
      )}

      {textEditing && selectedTable && (
        <AdminTextEditorModal
          title={`${selectedTable} — row ${textEditing.rowIndex + 1}`}
          column={textEditing.column}
          value={textEditing.value}
          onClose={() => setTextEditing(null)}
          onSave={commitTextEdit}
        />
      )}

      {showInsert && schema && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-[#141414] p-6 shadow-2xl">
            <h3 className="mb-4 font-semibold">Insert into {selectedTable}</h3>
            <div className="space-y-3">
              {Object.keys(insertDraft).map((name) => {
                const meta = schemaByCol.get(name);
                return (
                  <div key={name}>
                    <label className="mb-1 block font-mono text-xs text-white/60">
                      {name}
                      {meta && <span className="ml-2 text-white/30">{meta.data_type}</span>}
                    </label>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 font-mono text-sm"
                      value={insertDraft[name] ?? ""}
                      onChange={(e) => setInsertDraft((d) => ({ ...d, [name]: e.target.value }))}
                      placeholder={meta?.is_nullable ? "optional" : "required"}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-4 py-2 text-sm"
                onClick={() => setShowInsert(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
                onClick={handleInsert}
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
