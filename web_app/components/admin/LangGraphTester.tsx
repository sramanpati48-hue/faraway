"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useReactFlow,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  MarkerType,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AdminErrorBanner,
  adminBtnPrimary,
  adminBtnSecondary,
  adminInput,
  adminSelect,
} from "@/components/admin/admin-ui";
import { AdminModelSelector, defaultForProvider } from "@/components/admin/AdminModelSelector";
import { VoiceInput } from "@/components/chat/VoiceInput";
import { adminApi, type AdminModelsSnapshot } from "@/lib/adminApi";
import {
  fetchMockCases,
  type ClashMode,
  type ClashMockCase,
  type UserRole,
} from "@/lib/clashApi";

/** Floating LangGraph panels — match AdminShell / adminCard tokens. */
const testerAsideShell =
  "admin-scrollbar absolute bottom-0 top-0 z-20 overflow-y-auto border-white/[0.08] bg-[#030303] shadow-[0_12px_40px_rgba(0,0,0,0.55)]";
const testerAsideHeader =
  "flex items-center justify-between border-b border-white/[0.07] bg-[#050505] px-3 py-2.5";
const testerSectionLabel =
  "text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35";
const testerPanel = cn(
  "rounded-xl border border-white/[0.09] bg-[#0c0c0c] p-2.5",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
);
const testerChip =
  "inline-flex items-center rounded-lg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide";
const testerIconBtn =
  "inline-flex items-center gap-1 rounded-xl border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-white/65 transition hover:bg-white/[0.08] hover:text-white/90 disabled:opacity-40";

type GraphStateSnapshot = {
  plan: string[];
  phase?: string;
  actions: unknown[];
  links: unknown[];
  flags: { key: string; value: string }[];
  waitingModerator?: boolean;
};

function extractGraphSnapshot(output: unknown): GraphStateSnapshot | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const o = output as Record<string, unknown>;
  const report =
    o.structured_report && typeof o.structured_report === "object" && !Array.isArray(o.structured_report)
      ? (o.structured_report as Record<string, unknown>)
      : {};
  const plan = Array.isArray(o.agent_plan) ? o.agent_plan.map((p) => String(p)) : [];
  const actions = Array.isArray(o.suggested_actions) ? o.suggested_actions : [];
  const links = Array.isArray(o.suggested_links) ? o.suggested_links : [];
  const flagPairs: [string, unknown][] = [
    ["phase", o.phase],
    ["cognizable", o.cognizable ?? report.cognizable],
    ["mlat", o.is_complex_mlat ?? report.is_complex_mlat],
    ["fraud_under_10k", o.fraud_under_10k ?? report.fraud_under_10k],
    ["lawyer_needed", o.lawyer_needed],
    ["intervention", o.intervention_required],
  ];
  const flags = flagPairs
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
  const waitingModerator = Boolean(o.waiting_for_moderator_resolution);
  if (
    !plan.length &&
    !actions.length &&
    !links.length &&
    !flags.length &&
    !waitingModerator
  ) {
    return null;
  }
  return {
    plan,
    phase: typeof o.phase === "string" ? o.phase : undefined,
    actions,
    links,
    flags,
    waitingModerator,
  };
}

function GraphSnapshotPane({ snapshot, title }: { snapshot: GraphStateSnapshot; title: string }) {
  return (
    <div className={cn(testerPanel, "mt-2.5 space-y-2")}>
      <p className={testerSectionLabel}>{title}</p>
      {snapshot.plan.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {snapshot.plan.map((node, idx) => (
            <span
              key={`${node}-${idx}`}
              className={cn(testerChip, "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/25")}
            >
              {idx + 1}. {node}
            </span>
          ))}
        </div>
      )}
      {snapshot.flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {snapshot.flags.map((flag) => (
            <span
              key={flag.key}
              className={cn(testerChip, "bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/25")}
            >
              {flag.key}: {flag.value}
            </span>
          ))}
        </div>
      )}
      {snapshot.waitingModerator ? (
        <p className="text-[10px] font-medium text-rose-200/90">Paused for moderator snapshot</p>
      ) : null}
      {snapshot.actions.length > 0 ? (
        <ThemeJsonBlock value={snapshot.actions} tone="output" maxHeightClass="max-h-28" />
      ) : null}
      {snapshot.links.length > 0 ? (
        <ThemeJsonBlock value={snapshot.links} tone="neutral" maxHeightClass="max-h-24" />
      ) : null}
    </div>
  );
}

type JsonTone = "neutral" | "input" | "output" | "error";

function ThemeJsonBlock({
  value,
  tone = "neutral",
  className,
  maxHeightClass = "max-h-48",
}: {
  value: unknown;
  tone?: JsonTone;
  className?: string;
  maxHeightClass?: string;
}) {
  const text =
    value === undefined
      ? "undefined"
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);

  const shell = cn(
    "admin-scrollbar mt-1.5 overflow-auto whitespace-pre-wrap break-words rounded-xl border p-2.5 font-mono text-[10px] leading-relaxed",
    maxHeightClass,
    tone === "input" && "border-sky-500/20 bg-[#061018]",
    tone === "output" && "border-emerald-500/20 bg-[#06140f]",
    tone === "error" && "border-red-500/25 bg-[#140808]",
    tone === "neutral" && "border-white/[0.07] bg-[#080808]",
    className
  );

  // Keep plain strings (errors, __end__) without tokenizing.
  if (typeof value === "string" || value === undefined || value === null) {
    return (
      <pre
        className={cn(
          shell,
          tone === "input" && "text-sky-200/70",
          tone === "output" && "text-emerald-200/70",
          tone === "error" && "text-red-200/80",
          tone === "neutral" && "text-white/55"
        )}
      >
        {value === null ? "null" : text}
      </pre>
    );
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { _truncated?: boolean })._truncated
  ) {
    return (
      <div className="mt-1.5 space-y-1.5">
        <p className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-2 py-1.5 text-[10px] text-amber-100/85">
          Payload was truncated in storage — open Copy I/O / checkpoint final_state for the live
          values, or re-run after the tracer fix.
        </p>
        <pre className={cn(shell, "text-amber-100/60")}>{text}</pre>
      </div>
    );
  }

  const parts: ReactNode[] = [];
  const src = text;
  const re =
    /("(?:\\.|[^"\\])*")\s*(:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={key++} className="text-white/25">
          {src.slice(last, m.index)}
        </span>
      );
    }
    if (m[1] != null) {
      const isKey = Boolean(m[2]);
      parts.push(
        <span
          key={key++}
          className={
            isKey
              ? tone === "input"
                ? "text-sky-300/85"
                : tone === "output"
                  ? "text-emerald-300/85"
                  : "text-emerald-400/75"
              : "text-amber-100/65"
          }
        >
          {m[1]}
        </span>
      );
      if (m[2]) {
        parts.push(
          <span key={key++} className="text-white/30">
            :
          </span>
        );
      }
    } else if (m[3] != null) {
      parts.push(
        <span key={key++} className="text-cyan-300/70">
          {m[3]}
        </span>
      );
    } else if (m[4] != null) {
      parts.push(
        <span key={key++} className="text-violet-300/70">
          {m[4]}
        </span>
      );
    } else if (m[5] != null) {
      parts.push(
        <span key={key++} className="text-white/30">
          {m[5]}
        </span>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    parts.push(
      <span key={key++} className="text-white/25">
        {src.slice(last)}
      </span>
    );
  }

  return <pre className={shell}>{parts}</pre>;
}

type GraphMeta = {
  graph_id: string;
  display_name?: string;
  version?: string;
  topology?: {
    nodes: { id: string; label?: string }[];
    edges: { id?: string; source: string; target: string; conditional?: boolean }[];
    entry_node?: string;
  };
};

type NodeStatus = "idle" | "visited" | "failed" | "selected" | "entry" | "awaiting";

type AwaitingPrompt = {
  id: string;
  label: string;
  hint?: string | null;
  node_id?: string;
  kind?: string;
  index?: number;
  total?: number;
  choices?: { id: string; label: string }[];
  user_action?: string;
  ai_assist_allowed?: boolean;
  question_target?: string;
  mode?: string;
  user_role?: string;
};

type GraphEvent = {
  id: string | number;
  node_id: string;
  event_type: string;
  duration_ms?: number | null;
  error?: string | null;
  input_payload?: unknown;
  output_payload?: unknown;
  sequence_no?: number | null;
};

type CanvasMode = "topology" | "live";

type LiveStep = {
  stepKey: string;
  stepIndex: number;
  nodeId: string;
  label: string;
  status: NodeStatus;
  durationMs?: number;
  eventIds: (string | number)[];
};

type GraphRunRecord = {
  id: string;
  query?: string;
  status?: string;
  path?: string[];
  final_state?: Record<string, unknown> | null;
  parent_run_id?: string | null;
  fork_node_id?: string | null;
};

type ActiveGraphRun = {
  run: GraphRunRecord;
  events: GraphEvent[];
  awaiting_input?: {
    awaiting?: boolean;
    prompts?: AwaitingPrompt[];
    final_response?: string;
  };
};

type GraphPreset = {
  id: string;
  name: string;
  query: string;
  initial_state?: Record<string, unknown> | null;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type GraphNodeData = {
  label: string;
  nodeId: string;
  status: NodeStatus;
  stepIndex?: number;
  durationMs?: number;
  isEntry?: boolean;
  isEnd?: boolean;
  isSide?: boolean;
  needsInput?: boolean;
  locationLabel?: string;
};

/** Intake / helper nodes parked beside their anchor (not in the main column). */
const SIDE_NODES: Record<string, string> = {
  question_processor: "report_generator",
};
const SIDE_GAP = 120;

const END_NODE_ID = "__end__";
function isEndNodeId(id: string) {
  return id === END_NODE_ID || id === "END" || id === "__end__";
}
function normalizeEndId(id: string) {
  return isEndNodeId(id) ? END_NODE_ID : id;
}

const NODE_W = 280;
const NODE_H = 108;
const H_GAP = 96;
const V_GAP = 168;
/** Horizontal handle slots so sibling edges leave/enter at different X. */
const HANDLE_IDS = ["h0", "h1", "h2", "h3", "h4"] as const;

type DirectedEdgeData = {
  kind: "fixed" | "conditional" | "end" | "taken";
  sideLoop?: boolean;
  label?: string;
  stroke?: string;
};

function edgeStroke(kind: DirectedEdgeData["kind"]) {
  if (kind === "taken") return "#4ade80";
  if (kind === "end") return "#a78bfa";
  if (kind === "conditional") return "#fbbf24";
  return "#38bdf8";
}

/**
 * Orthogonal smooth-step path. Offset is always a small *positive* distance —
 * negative offsets make edges climb back over the source node and tangle.
 */
function DirectedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const d = (data || {}) as DirectedEdgeData;
  const kind = d.kind || "fixed";
  const color = d.stroke || (typeof style?.stroke === "string" ? style.stroke : edgeStroke(kind));
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const horizontal = Math.abs(dx) > Math.abs(dy) * 1.1;
  // Side loops are nearly horizontal — keep the step short so they don't dive to END.
  const stepOffset = d.sideLoop || horizontal
    ? Math.min(36, Math.max(16, Math.abs(dx) * 0.12))
    : Math.min(48, Math.max(18, Math.abs(dy) * 0.22));
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: d.sideLoop ? 8 : 12,
    offset: stepOffset,
  });

  const angleDeg = horizontal ? (dx >= 0 ? 90 : -90) : 0;
  const showBadge = kind === "taken" || !!d.label;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
        interactionWidth={20}
      />
      {showBadge ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)${d.label ? "" : ` rotate(${angleDeg}deg)`}`,
            }}
          >
            {d.label ? (
              <span
                className="rounded-md border border-fuchsia-400/50 bg-fuchsia-950/95 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-200 shadow-lg"
              >
                {d.label}
              </span>
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-950 text-emerald-300 shadow-lg">
                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden>
                  <path
                    d="M6 1.5v7.2M3.2 6.2 6 9.5l2.8-3.3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { directed: DirectedEdge };

function handleSlotStyle(index: number, total = HANDLE_IDS.length): CSSProperties {
  const pct = ((index + 1) / (total + 1)) * 100;
  return { left: `${pct}%` };
}

function pickHandleId(index: number, total: number): (typeof HANDLE_IDS)[number] {
  if (total <= 1) return HANDLE_IDS[2];
  if (total >= HANDLE_IDS.length) {
    return HANDLE_IDS[Math.min(index, HANDLE_IDS.length - 1)];
  }
  // Spread across available slots (e.g. 2 edges → h1,h3; 3 → h1,h2,h3)
  const slot = Math.round((index * (HANDLE_IDS.length - 1)) / Math.max(total - 1, 1));
  return HANDLE_IDS[slot];
}

function humanize(id: string) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function liveStepKey(stepIndex: number, nodeId: string) {
  return `${stepIndex}:${nodeId}`;
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

/** Prefer first start input + last meaningful end output for a step's matched events. */
function ioFromEvents(events: GraphEvent[]): { input: unknown; output: unknown } {
  const sorted = [...events].sort(
    (a, b) => Number(a.sequence_no ?? 0) - Number(b.sequence_no ?? 0)
  );
  let input: unknown = null;
  let output: unknown = null;
  let sawStart = false;
  for (const ev of sorted) {
    if (ev.event_type === "start" && !sawStart) {
      sawStart = true;
      input = ev.input_payload !== undefined ? ev.input_payload : null;
    }
    if (ev.event_type === "end") {
      const payload = ev.output_payload;
      // Ignore LangGraph route strings ("prosecution", "__end__") when a real dict exists later.
      if (payload !== undefined && payload !== null) {
        if (typeof payload === "object") {
          output = payload;
        } else if (output === null || typeof output === "string") {
          output = payload;
        }
      }
    }
  }
  return { input, output };
}

function liveStepIoKey(stepIndex: number, nodeId: string) {
  return `step ${stepIndex} [${humanize(nodeId)}]`;
}

/** One card per path step; revisits become new steps. Match start+end/error by sequence. */
function buildLiveSteps(
  path: string[],
  events: GraphEvent[],
  awaitingNodeIds: Set<string>
): LiveStep[] {
  const sorted = [...events].sort(
    (a, b) => Number(a.sequence_no ?? 0) - Number(b.sequence_no ?? 0)
  );
  const byNode = new Map<string, GraphEvent[]>();
  for (const ev of sorted) {
    if (!ev.node_id) continue;
    if (!byNode.has(ev.node_id)) byNode.set(ev.node_id, []);
    byNode.get(ev.node_id)!.push(ev);
  }
  const cursor = new Map<string, number>();

  return path.map((nodeId, i) => {
    const list = byNode.get(nodeId) || [];
    let idx = cursor.get(nodeId) || 0;
    const eventIds: (string | number)[] = [];
    let durationMs: number | undefined;
    let failed = false;

    if (idx < list.length && list[idx].event_type === "start") {
      eventIds.push(list[idx].id);
      idx += 1;
    }
    if (idx < list.length && (list[idx].event_type === "end" || list[idx].event_type === "error")) {
      if (list[idx].event_type === "error") failed = true;
      if (list[idx].duration_ms != null) durationMs = Number(list[idx].duration_ms);
      eventIds.push(list[idx].id);
      idx += 1;
    }
    cursor.set(nodeId, idx);

    const isLast = i === path.length - 1;
    const awaiting = isLast && awaitingNodeIds.has(nodeId);
    let status: NodeStatus = "visited";
    if (awaiting) status = "awaiting";
    else if (failed) status = "failed";

    return {
      stepKey: liveStepKey(i + 1, nodeId),
      stepIndex: i + 1,
      nodeId,
      label: humanize(nodeId),
      status,
      durationMs,
      eventIds,
    };
  });
}

function GraphAgentNode({ data, selected }: NodeProps) {
  const d = data as GraphNodeData;
  const status: NodeStatus =
    d.status === "selected" || selected
      ? "selected"
      : d.status === "idle" && d.isEntry
        ? "entry"
        : d.status;
  const showSidePorts = !!d.isSide || d.nodeId === "report_generator";

  return (
    <div
      className={cn(
        "box-border flex h-[108px] w-[280px] flex-col justify-center rounded-2xl border-[3px] px-4 shadow-2xl",
        d.isSide && status === "idle" && "border-fuchsia-500/80 bg-fuchsia-950/80 text-white",
        d.isSide && status === "visited" && "border-fuchsia-300 bg-fuchsia-900 text-white",
        d.isSide && status === "awaiting" && "border-orange-400 bg-orange-950 text-white ring-4 ring-orange-400/35",
        d.isEnd && status === "idle" && "border-violet-500 bg-violet-950 text-white",
        d.isEnd && status === "visited" && "border-violet-300 bg-violet-800 text-white",
        !d.isEnd && !d.isSide && status === "visited" && "border-emerald-400 bg-emerald-900 text-white",
        status === "failed" && "border-red-400 bg-red-900 text-white",
        status === "selected" && "border-sky-400 bg-sky-900 text-white ring-4 ring-sky-400/40",
        !d.isSide && status === "awaiting" && "border-orange-400 bg-orange-950 text-white ring-4 ring-orange-400/35",
        !d.isEnd && !d.isSide && status === "entry" && "border-amber-400 bg-amber-900 text-white",
        !d.isEnd && !d.isSide && status === "idle" && "border-zinc-500 bg-zinc-900 text-white"
      )}
    >
      {/* Main-column inbound; side nodes keep one top port for supervisor → intake */}
      {!d.isSide
        ? HANDLE_IDS.map((hid, i) => (
            <Handle
              key={`t-${hid}`}
              id={hid}
              type="target"
              position={Position.Top}
              style={handleSlotStyle(i)}
              className="!top-0 !h-3 !w-3 !rounded-full !border-2 !border-black !bg-cyan-300"
            />
          ))
        : (
            <Handle
              id={HANDLE_IDS[2]}
              type="target"
              position={Position.Top}
              className="!top-0 !h-3 !w-3 !rounded-full !border-2 !border-black !bg-cyan-300"
            />
          )}
      {/* Side-loop ports: report (right) ↔ question_processor (left) */}
      {showSidePorts && d.isSide ? (
        <>
          <Handle
            id="side-in"
            type="target"
            position={Position.Left}
            style={{ top: "35%" }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-fuchsia-300"
          />
          <Handle
            id="side-out"
            type="source"
            position={Position.Left}
            style={{ top: "65%" }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-fuchsia-300"
          />
        </>
      ) : null}
      {showSidePorts && !d.isSide ? (
        <>
          <Handle
            id="side-out"
            type="source"
            position={Position.Right}
            style={{ top: "35%" }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-fuchsia-300"
          />
          <Handle
            id="side-in"
            type="target"
            position={Position.Right}
            style={{ top: "65%" }}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-black !bg-fuchsia-300"
          />
        </>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
            {d.isEnd
              ? "■ END"
              : d.isSide
                ? "⇄ SIDE"
                : d.needsInput
                  ? "INPUT"
                  : d.isEntry
                    ? "▶ START"
                    : "NODE"}
          </p>
          <p className="truncate text-xl font-bold leading-tight tracking-tight">{d.label}</p>
        </div>
        {d.stepIndex != null ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/35 text-lg font-black">
            {d.stepIndex}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 uppercase tracking-wide",
            d.isSide && status === "idle" && "bg-fuchsia-400 text-fuchsia-950",
            d.isSide && status === "visited" && "bg-fuchsia-300 text-fuchsia-950",
            d.isEnd && "bg-violet-300 text-violet-950",
            !d.isEnd && !d.isSide && status === "visited" && "bg-emerald-400 text-emerald-950",
            status === "failed" && "bg-red-400 text-red-950",
            status === "selected" && "bg-sky-300 text-sky-950",
            status === "awaiting" && "bg-orange-300 text-orange-950",
            !d.isEnd && !d.isSide && status === "entry" && "bg-amber-300 text-amber-950",
            !d.isEnd && !d.isSide && status === "idle" && "bg-zinc-600 text-white"
          )}
        >
          {d.isSide && status === "idle"
            ? "intake"
            : d.isEnd
              ? status === "visited"
                ? "final"
                : "terminal"
              : status === "idle"
                ? "waiting"
                : status === "awaiting"
                  ? "needs input"
                  : status}
        </span>
        {d.durationMs != null ? (
          <span className="text-white/80">{Math.round(d.durationMs)}ms</span>
        ) : null}
        {d.locationLabel ? (
          <span className="max-w-[120px] truncate rounded-md bg-black/30 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200" title={d.locationLabel}>
            {d.locationLabel}
          </span>
        ) : null}
      </div>
      {/* Main-column outbound */}
      {!d.isEnd && !d.isSide
        ? HANDLE_IDS.map((hid, i) => (
            <Handle
              key={`s-${hid}`}
              id={hid}
              type="source"
              position={Position.Bottom}
              style={handleSlotStyle(i)}
              className="!bottom-0 !h-3 !w-3 !rounded-full !border-2 !border-black !bg-amber-300"
            />
          ))
        : null}
    </div>
  );
}

const nodeTypes = { agent: GraphAgentNode };

/**
 * Layered vertical layout (Sugiyama-ish): longest-path ranks + barycenter
 * reordering to cut edge crossings. Side nodes (e.g. question_processor) sit
 * beside their anchor instead of in the main column.
 */
function layoutLayeredGraph(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  entry?: string
): Map<string, { x: number; y: number }> {
  const ids = nodeIds
    .map(normalizeEndId)
    .filter((id) => id === END_NODE_ID || (!id.startsWith("__") && id !== "START"));
  const allIds = [...new Set(ids)];
  const sideIds = allIds.filter((id) => id in SIDE_NODES);
  const uniqueIds = allIds.filter((id) => !(id in SIDE_NODES));
  const adj = new Map<string, string[]>();
  const preds = new Map<string, string[]>();
  for (const id of uniqueIds) {
    adj.set(id, []);
    preds.set(id, []);
  }
  for (const e of edges) {
    const source = normalizeEndId(e.source);
    const target = normalizeEndId(e.target);
    // Ignore side-loop edges for main ranking (report ⇄ question_processor)
    if (source in SIDE_NODES || target in SIDE_NODES) continue;
    if (!adj.has(source) || !adj.has(target)) continue;
    if (source === target) continue;
    if (source.startsWith("__") && source !== END_NODE_ID) continue;
    adj.get(source)!.push(target);
    preds.get(target)!.push(source);
  }

  const start =
    (entry && uniqueIds.includes(entry) && entry) ||
    uniqueIds.find((id) => id !== END_NODE_ID && (preds.get(id) || []).length === 0) ||
    uniqueIds.find((id) => id !== END_NODE_ID) ||
    uniqueIds[0];

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const dfs = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = preds.get(id) || [];
    let r = 0;
    if (parents.length) {
      r = Math.max(...parents.map((p) => dfs(p))) + 1;
    } else if (id !== start) {
      r = 1;
    }
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  if (start) dfs(start);
  for (const id of uniqueIds) dfs(id);

  if (uniqueIds.includes(END_NODE_ID)) {
    const endParents = preds.get(END_NODE_ID) || [];
    const parentMax = endParents.length
      ? Math.max(...endParents.map((p) => rank.get(p) ?? 0))
      : Math.max(0, ...[...rank.values()]);
    rank.set(END_NODE_ID, parentMax + 1);
  }

  const byRank = new Map<number, string[]>();
  for (const id of uniqueIds) {
    const r = rank.get(id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(id);
  }

  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const r of ranks) {
    byRank.get(r)!.sort((a, b) => {
      if (a === start) return -1;
      if (b === start) return 1;
      return a.localeCompare(b);
    });
  }

  const indexInRank = (id: string) => {
    const row = byRank.get(rank.get(id) ?? 0) || [];
    const i = row.indexOf(id);
    return i < 0 ? 0 : i;
  };

  const bary = (neighbors: string[]) => {
    if (!neighbors.length) return Number.POSITIVE_INFINITY;
    return neighbors.reduce((s, n) => s + indexInRank(n), 0) / neighbors.length;
  };

  // Sweep down/up a few times so children sit under their parents (fewer crossings).
  for (let iter = 0; iter < 4; iter++) {
    for (let ri = 1; ri < ranks.length; ri++) {
      const row = byRank.get(ranks[ri])!;
      row.sort((a, b) => {
        if (a === END_NODE_ID) return 1;
        if (b === END_NODE_ID) return -1;
        const ba = bary(preds.get(a) || []);
        const bb = bary(preds.get(b) || []);
        if (ba !== bb) return ba - bb;
        return a.localeCompare(b);
      });
    }
    for (let ri = ranks.length - 2; ri >= 0; ri--) {
      const row = byRank.get(ranks[ri])!;
      row.sort((a, b) => {
        if (a === start) return -1;
        if (b === start) return 1;
        const ba = bary(adj.get(a) || []);
        const bb = bary(adj.get(b) || []);
        if (ba !== bb) return ba - bb;
        return a.localeCompare(b);
      });
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const r of ranks) {
    const row = byRank.get(r)!;
    const totalW = row.length * NODE_W + Math.max(row.length - 1, 0) * H_GAP;
    const left = -totalW / 2;
    row.forEach((id, i) => {
      positions.set(id, {
        x: left + i * (NODE_W + H_GAP),
        y: r * (NODE_H + V_GAP),
      });
    });
  }

  // Park side nodes to the right of their anchor at the same vertical level
  for (const sideId of sideIds) {
    const anchorId = SIDE_NODES[sideId];
    const anchor = positions.get(anchorId);
    if (anchor) {
      positions.set(sideId, {
        x: anchor.x + NODE_W + SIDE_GAP,
        y: anchor.y,
      });
    } else {
      // Anchor missing — place to the right of the graph
      const maxX = Math.max(0, ...[...positions.values()].map((p) => p.x));
      const midY =
        positions.size > 0
          ? [...positions.values()].reduce((s, p) => s + p.y, 0) / positions.size
          : 0;
      positions.set(sideId, { x: maxX + NODE_W + SIDE_GAP, y: midY });
    }
  }
  return positions;
}

function isSideLoopEdge(source: string, target: string): boolean {
  return (
    (source in SIDE_NODES && SIDE_NODES[source] === target) ||
    (target in SIDE_NODES && SIDE_NODES[target] === source)
  );
}

/** Assign left→right source/target handles so edges don't share one exit/entry point. */
function assignEdgeHandles(
  edges: { source: string; target: string }[],
  positions: Map<string, { x: number; y: number }>
): Map<string, { sourceHandle: string; targetHandle: string }> {
  const keyOf = (e: { source: string; target: string }) => `${e.source}->${e.target}`;
  const result = new Map<string, { sourceHandle: string; targetHandle: string }>();

  const bySource = new Map<string, typeof edges>();
  const byTarget = new Map<string, typeof edges>();
  for (const e of edges) {
    // Side-loop edges use dedicated left/right ports
    if (isSideLoopEdge(e.source, e.target)) {
      result.set(keyOf(e), { sourceHandle: "side-out", targetHandle: "side-in" });
      continue;
    }
    // supervisor → side intake: land on the single top port
    if (e.target in SIDE_NODES) {
      result.set(keyOf(e), {
        sourceHandle: HANDLE_IDS[2],
        targetHandle: HANDLE_IDS[2],
      });
      continue;
    }
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    if (!byTarget.has(e.target)) byTarget.set(e.target, []);
    bySource.get(e.source)!.push(e);
    byTarget.get(e.target)!.push(e);
  }

  const sourceHandle = new Map<string, string>();
  const targetHandle = new Map<string, string>();

  for (const [, group] of bySource) {
    group.sort((a, b) => {
      const ax = positions.get(a.target)?.x ?? 0;
      const bx = positions.get(b.target)?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return a.target.localeCompare(b.target);
    });
    group.forEach((e, i) => {
      sourceHandle.set(keyOf(e), pickHandleId(i, group.length));
    });
  }

  for (const [, group] of byTarget) {
    group.sort((a, b) => {
      const ax = positions.get(a.source)?.x ?? 0;
      const bx = positions.get(b.source)?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return a.source.localeCompare(b.source);
    });
    group.forEach((e, i) => {
      targetHandle.set(keyOf(e), pickHandleId(i, group.length));
    });
  }

  for (const e of edges) {
    const k = keyOf(e);
    result.set(k, {
      sourceHandle: sourceHandle.get(k) || HANDLE_IDS[2],
      targetHandle: targetHandle.get(k) || HANDLE_IDS[2],
    });
  }
  return result;
}

function FlowCanvas({
  nodes,
  edges,
  onSelect,
  graphKey,
  mode = "topology",
}: {
  nodes: Node[];
  edges: Edge[];
  onSelect: (id: string) => void;
  graphKey: string;
  mode?: CanvasMode;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const t = window.setTimeout(() => {
      fitView({ padding: 0.22, duration: 200, maxZoom: 0.9, minZoom: 0.25 });
    }, 80);
    return () => window.clearTimeout(t);
  }, [graphKey, nodes.length, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.22, maxZoom: 0.9 }}
      minZoom={0.15}
      maxZoom={1.4}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnScroll
      zoomOnScroll
      connectionLineType={ConnectionLineType.SmoothStep}
      defaultEdgeOptions={{
        type: "directed",
        markerEnd: { type: MarkerType.ArrowClosed, width: 22, height: 22 },
      }}
      onNodeClick={(_: MouseEvent, n) => onSelect(n.id)}
      onPaneClick={() => onSelect("")}
      proOptions={{ hideAttribution: true }}
      className="h-full w-full bg-[#050505]"
    >
      <Background gap={28} size={1.5} color="rgba(255,255,255,0.12)" />
      <Controls
        showInteractive={false}
        className="!rounded-xl !border-white/[0.08] !bg-[#030303] !shadow-[0_8px_32px_rgba(0,0,0,0.45)] [&>button]:!h-8 [&>button]:!w-8 [&>button]:!border-white/[0.1] [&>button]:!bg-white/[0.04] [&>button]:!fill-white/80 [&>button:hover]:!bg-white/[0.08]"
      />
      <div className="pointer-events-none absolute top-3 left-3 z-10 rounded-xl border border-white/[0.09] bg-[#030303]/90 px-3 py-2 text-[10px] text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm">
        {mode === "live" ? (
          <>
            <p className="mb-1.5 font-bold uppercase tracking-wider text-white/45">Live nodes</p>
            <p className="max-w-[180px] leading-relaxed text-white/60">
              Execution order — each visit is a new card. Click a step for its input / output.
            </p>
            {nodes.length === 0 ? (
              <p className="mt-2 text-amber-200/80">Run the graph to accumulate steps.</p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mb-1.5 font-bold uppercase tracking-wider text-white/45">Flow direction</p>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span>Out (bottom)</span>
              <span className="text-white/30">→</span>
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-300" />
              <span>In (top)</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-6 rounded bg-sky-400" />
                <span>Always</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-6 rounded border-t-2 border-dashed border-amber-400" />
                <span>Conditional</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-6 rounded border-t-2 border-dashed border-fuchsia-400" />
                <span>Side intake loop</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-6 rounded bg-violet-400" />
                <span>To END</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-6 rounded bg-emerald-400" />
                <span>Taken path</span>
              </div>
            </div>
          </>
        )}
      </div>
    </ReactFlow>
  );
}

export function LangGraphTester() {
  const [graphs, setGraphs] = useState<GraphMeta[]>([]);
  const [graphId, setGraphId] = useState("chat_agent");
  const [query, setQuery] = useState("Someone stole money from my UPI account in Delhi");
  const [presets, setPresets] = useState<GraphPreset[]>([]);
  const [runInitialState, setRunInitialState] = useState<Record<string, unknown> | null>({
    location: { city: "Delhi", state: "Delhi", lat: 28.6139, lon: 77.209 },
    user_details: { location: { city: "Delhi", state: "Delhi", lat: 28.6139, lon: 77.209 } },
  });
  const [runs, setRuns] = useState<GraphRunRecord[]>([]);
  const [activeRun, setActiveRun] = useState<ActiveGraphRun | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("topology");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [modelSnapshot, setModelSnapshot] = useState<AdminModelsSnapshot | null>(null);
  const [showReplayEditor, setShowReplayEditor] = useState(false);
  const [payloadDraft, setPayloadDraft] = useState("");
  const [originalPayload, setOriginalPayload] = useState<Record<string, unknown> | null>(null);
  const [payloadPrompt, setPayloadPrompt] = useState("");
  const [payloadProvider, setPayloadProvider] = useState("groq");
  const [payloadModel, setPayloadModel] = useState("llama-3.3-70b-versatile");
  const [payloadBusy, setPayloadBusy] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  // Clash Mode setup — mirrors /clash practice vs real_life intake
  const [clashMode, setClashMode] = useState<ClashMode>("practice");
  const [clashRole, setClashRole] = useState<UserRole>("prosecution");
  const [clashTitle, setClashTitle] = useState("");
  const [clashFacts, setClashFacts] = useState("");
  const [clashMockCases, setClashMockCases] = useState<ClashMockCase[]>([]);
  const [clashMockId, setClashMockId] = useState<string | null>(null);
  const [showClashSetup, setShowClashSetup] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  /** Task 6: full per-node event I/O + Copy live JSON (off by default for Clash). */
  const [debugEvents, setDebugEvents] = useState(false);

  const isClashGraph = graphId === "clash_agent";

  const selectedGraph = graphs.find((g) => g.graph_id === graphId);
  const awaiting = activeRun?.awaiting_input as
    | { awaiting?: boolean; prompts?: AwaitingPrompt[]; final_response?: string }
    | undefined;
  const awaitingPrompts = useMemo(
    () => (awaiting?.awaiting ? awaiting.prompts || [] : []),
    [awaiting]
  );
  const awaitingNodeIds = useMemo(
    () => new Set(awaitingPrompts.map((p) => p.node_id).filter(Boolean) as string[]),
    [awaitingPrompts]
  );

  const load = useCallback(async () => {
    try {
      const [g, p, r] = await Promise.all([
        adminApi.graphs(),
        adminApi.presets(graphId),
        adminApi.runs(graphId),
      ]);
      setGraphs(g.graphs || []);
      setPresets(p.presets || []);
      setRuns(r.runs || []);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load graph data"));
    }
  }, [graphId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isClashGraph) return;
    void fetchMockCases()
      .then(setClashMockCases)
      .catch(() => setClashMockCases([]));
  }, [isClashGraph]);

  useEffect(() => {
    void adminApi
      .aiModels()
      .then(setModelSnapshot)
      .catch((e: unknown) => setError(errorMessage(e, "Failed to load model catalog")));
  }, []);

  useEffect(() => {
    setShowReplayEditor(false);
    setPayloadDraft("");
    setOriginalPayload(null);
    setPayloadPrompt("");
    setPayloadError(null);
    if (!selectedNode || !modelSnapshot || isEndNodeId(selectedNode)) return;
    const resolved = modelSnapshot.resolved?.[`${graphId}.${selectedNode}`];
    const provider = resolved?.provider || "groq";
    setPayloadProvider(provider);
    setPayloadModel(resolved?.model || defaultForProvider(modelSnapshot.env, provider));
  }, [selectedNode, graphId, modelSnapshot]);

  const path = useMemo(() => (activeRun?.run?.path as string[]) || [], [activeRun]);
  const failedNodes = useMemo(() => {
    const set = new Set<string>();
    for (const ev of activeRun?.events || []) {
      if (ev.event_type === "error") set.add(ev.node_id);
    }
    return set;
  }, [activeRun]);

  const durationByNode = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of activeRun?.events || []) {
      if (ev.node_id && ev.duration_ms != null) map.set(ev.node_id, Number(ev.duration_ms));
    }
    return map;
  }, [activeRun]);

  const stepIndexByNode = useMemo(() => {
    const map = new Map<string, number>();
    path.forEach((id, i) => {
      if (!map.has(id)) map.set(id, i + 1);
    });
    return map;
  }, [path]);

  const liveSteps = useMemo(
    () => buildLiveSteps(path, activeRun?.events || [], awaitingNodeIds),
    [path, activeRun?.events, awaitingNodeIds]
  );

  const liveStepByKey = useMemo(() => {
    const map = new Map<string, LiveStep>();
    for (const step of liveSteps) map.set(step.stepKey, step);
    return map;
  }, [liveSteps]);

  const runCompleted =
    activeRun?.run?.status === "completed" ||
    (!!activeRun?.run?.final_state && !awaiting?.awaiting && path.length > 0);

  const displayPath = useMemo(() => {
    const base = path.map(normalizeEndId);
    if (runCompleted && !base.includes(END_NODE_ID)) {
      return [...base, END_NODE_ID];
    }
    return base;
  }, [path, runCompleted]);

  const displayPathSet = useMemo(() => new Set(displayPath), [displayPath]);

  const { nodes, edges, graphKey } = useMemo(() => {
    const rawNodes = selectedGraph?.topology?.nodes || [];
    const rawEdges = selectedGraph?.topology?.edges || [];

    const agentNodes = rawNodes
      .map((n) => ({ ...n, id: normalizeEndId(String(n.id)) }))
      .filter((n) => n.id === END_NODE_ID || !String(n.id).startsWith("__"));

    // Always ensure a single END terminal is present for chat/clash graphs
    if (!agentNodes.some((n) => n.id === END_NODE_ID)) {
      agentNodes.push({ id: END_NODE_ID, label: "END" });
    }

    const topoEdges = rawEdges
      .map((e) => ({
        ...e,
        source: normalizeEndId(String(e.source)),
        target: normalizeEndId(String(e.target)),
      }))
      .filter((e) => {
        if (e.source.startsWith("__") && e.source !== END_NODE_ID) return false;
        if (e.target.startsWith("__") && e.target !== END_NODE_ID) return false;
        if (e.source === e.target) return false;
        // Pause edges (side intake → END) look like the flow "never returns"; hide them.
        // Runtime still pauses via next_step=END; the structural loop is side → report.
        if (e.source in SIDE_NODES && e.target === END_NODE_ID) return false;
        return true;
      });

    // Guarantee the side-loop return edge is visible (report ← question_processor)
    for (const [sideId, anchorId] of Object.entries(SIDE_NODES)) {
      const hasSide = agentNodes.some((n) => n.id === sideId);
      const hasAnchor = agentNodes.some((n) => n.id === anchorId);
      if (!hasSide || !hasAnchor) continue;
      if (!topoEdges.some((e) => e.source === sideId && e.target === anchorId)) {
        topoEdges.push({
          id: `${sideId}->${anchorId}`,
          source: sideId,
          target: anchorId,
          conditional: true,
        });
      }
      if (!topoEdges.some((e) => e.source === anchorId && e.target === sideId)) {
        topoEdges.push({
          id: `${anchorId}->${sideId}`,
          source: anchorId,
          target: sideId,
          conditional: true,
        });
      }
    }

    // Deduplicate nodes by id
    const seen = new Set<string>();
    const topoNodes = agentNodes.filter((n) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    const positions = layoutLayeredGraph(
      topoNodes.map((n) => n.id),
      topoEdges,
      selectedGraph?.topology?.entry_node
    );
    const entry = selectedGraph?.topology?.entry_node;
    const traversed = new Set<string>();
    for (let i = 1; i < displayPath.length; i++) {
      traversed.add(`${displayPath[i - 1]}->${displayPath[i]}`);
    }

    const locObj =
      (activeRun?.run?.final_state?.location as Record<string, unknown> | undefined) ||
      ((activeRun?.run?.final_state?.user_details as Record<string, unknown> | undefined)?.location as
        | Record<string, unknown>
        | undefined) ||
      ((activeRun?.run?.final_state?.structured_report as Record<string, unknown> | undefined)?.location as
        | Record<string, unknown>
        | undefined);
    const locationLabel =
      locObj && (locObj.city || locObj.state)
        ? [locObj.city, locObj.state].filter(Boolean).join(", ")
        : undefined;

    const flowNodes: Node[] = topoNodes.map((n) => {
      const failed = failedNodes.has(n.id);
      const visited = displayPathSet.has(n.id);
      const needsInput = awaitingNodeIds.has(n.id);
      const selected = selectedNode === n.id;
      const isEnd = n.id === END_NODE_ID;
      let status: NodeStatus = "idle";
      if (selected) status = "selected";
      else if (needsInput) status = "awaiting";
      else if (failed) status = "failed";
      else if (visited) status = "visited";

      const isSide = n.id in SIDE_NODES;
      const showLoc = (n.id === "supervisor" || n.id === entry) && !!locationLabel;
      return {
        id: n.id,
        type: "agent",
        position: positions.get(n.id) || { x: 0, y: 0 },
        data: {
          label: isEnd ? "END · full payload" : humanize(n.label || n.id),
          nodeId: n.id,
          status,
          stepIndex: stepIndexByNode.get(n.id) ?? (isEnd && visited ? displayPath.length : undefined),
          durationMs: durationByNode.get(n.id),
          isEntry: n.id === entry,
          isEnd,
          isSide,
          needsInput,
          locationLabel: showLoc ? locationLabel : undefined,
        } satisfies GraphNodeData,
        selected,
      };
    });

    const handles = assignEdgeHandles(topoEdges, positions);

    const flowEdges: Edge[] = topoEdges.map((e) => {
      const key = `${e.source}->${e.target}`;
      const hit = traversed.has(key);
      const conditional = !!e.conditional;
      const toEnd = e.target === END_NODE_ID;
      const sideLoop = isSideLoopEdge(e.source, e.target);
      const kind: DirectedEdgeData["kind"] = hit
        ? "taken"
        : toEnd
          ? "end"
          : conditional
            ? "conditional"
            : "fixed";
      const color = sideLoop && !hit ? "#e879f9" : edgeStroke(kind);
      const ports = handles.get(key);
      const returningToReport = sideLoop && e.source in SIDE_NODES;

      return {
        id: e.id || key,
        source: e.source,
        target: e.target,
        sourceHandle: ports?.sourceHandle,
        targetHandle: ports?.targetHandle,
        type: "directed",
        animated: hit || sideLoop,
        data: {
          kind,
          sideLoop,
          stroke: color,
          label: returningToReport ? "back → rescore" : sideLoop ? "intake" : undefined,
        } satisfies DirectedEdgeData,
        style: {
          stroke: color,
          strokeWidth: hit ? 4 : sideLoop ? 3 : conditional ? 2.5 : 2.25,
          strokeDasharray: sideLoop && !hit ? "6 5" : conditional && !hit ? "10 7" : undefined,
          opacity: hit ? 1 : toEnd ? 0.55 : sideLoop ? 1 : 0.8,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 22,
          height: 22,
          color,
        },
        zIndex: hit ? 5 : sideLoop ? 6 : toEnd ? 0 : 2,
      } as Edge;
    });

    return {
      nodes: flowNodes,
      edges: flowEdges,
      graphKey: `${graphId}:${topoNodes.length}:${topoEdges.length}:${displayPath.join(">")}`,
    };
  }, [
    selectedGraph,
    displayPath,
    displayPathSet,
    failedNodes,
    selectedNode,
    stepIndexByNode,
    durationByNode,
    awaitingNodeIds,
    graphId,
    activeRun?.run?.final_state,
  ]);

  const {
    nodes: liveNodes,
    edges: liveEdges,
    graphKey: liveGraphKey,
  } = useMemo(() => {
    const flowNodes: Node[] = liveSteps.map((step, i) => {
      const selected = selectedStepKey === step.stepKey;
      let status: NodeStatus = step.status;
      if (selected) status = "selected";
      return {
        id: step.stepKey,
        type: "agent",
        position: { x: 0, y: i * (NODE_H + V_GAP) },
        data: {
          label: step.label,
          nodeId: step.nodeId,
          status,
          stepIndex: step.stepIndex,
          durationMs: step.durationMs,
          isEntry: step.stepIndex === 1,
          isEnd: false,
          isSide: false,
          needsInput: step.status === "awaiting",
        } satisfies GraphNodeData,
        selected,
      };
    });

    const flowEdges: Edge[] = [];
    for (let i = 0; i < liveSteps.length - 1; i++) {
      const source = liveSteps[i].stepKey;
      const target = liveSteps[i + 1].stepKey;
      const newest = i === liveSteps.length - 2;
      const color = edgeStroke("taken");
      flowEdges.push({
        id: `${source}->${target}`,
        source,
        target,
        sourceHandle: HANDLE_IDS[2],
        targetHandle: HANDLE_IDS[2],
        type: "directed",
        animated: newest,
        data: {
          kind: "taken",
          stroke: color,
        } satisfies DirectedEdgeData,
        style: {
          stroke: color,
          strokeWidth: newest ? 4 : 3,
          opacity: 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 22,
          height: 22,
          color,
        },
        zIndex: 5,
      } as Edge);
    }

    return {
      nodes: flowNodes,
      edges: flowEdges,
      graphKey: `live:${graphId}:${liveSteps.map((s) => s.stepKey).join(">")}`,
    };
  }, [liveSteps, selectedStepKey, graphId]);

  const canvasNodes = canvasMode === "live" ? liveNodes : nodes;
  const canvasEdges = canvasMode === "live" ? liveEdges : edges;
  const canvasGraphKey =
    canvasMode === "live" ? liveGraphKey : `topo:${graphKey}`;

  const finalPayload = activeRun?.run?.final_state ?? null;

  const nodeDetail = useMemo(() => {
    if (!activeRun) return null;
    if (canvasMode === "live" && selectedStepKey) {
      const step = liveStepByKey.get(selectedStepKey);
      if (!step) return [];
      const idSet = new Set(step.eventIds.map(String));
      return (activeRun.events || []).filter((event) => idSet.has(String(event.id)));
    }
    if (!selectedNode) return null;
    if (isEndNodeId(selectedNode)) return [];
    return (activeRun.events || []).filter((event) => event.node_id === selectedNode);
  }, [selectedNode, selectedStepKey, canvasMode, liveStepByKey, activeRun]);

  /** Group start→end/error into visit cards (one per execution), not raw lifecycle badges. */
  const nodeVisitCards = useMemo(() => {
    const events = [...(nodeDetail || [])].sort(
      (a, b) => Number(a.sequence_no ?? 0) - Number(b.sequence_no ?? 0)
    );
    if (!events.length) return [] as {
      key: string;
      input?: unknown;
      output?: unknown;
      error?: string | null;
      durationMs?: number | null;
      pending: boolean;
    }[];

    const cards: {
      key: string;
      input?: unknown;
      output?: unknown;
      error?: string | null;
      durationMs?: number | null;
      pending: boolean;
    }[] = [];
    let i = 0;
    while (i < events.length) {
      const ev = events[i];
      if (ev.event_type === "start") {
        const card = {
          key: String(ev.id),
          input: ev.input_payload,
          output: undefined as unknown,
          error: null as string | null,
          durationMs: null as number | null,
          pending: true,
        };
        const next = events[i + 1];
        if (next && (next.event_type === "end" || next.event_type === "error")) {
          card.pending = false;
          if (next.event_type === "end") card.output = next.output_payload;
          if (next.event_type === "error") card.error = next.error || "Node failed";
          if (next.duration_ms != null) card.durationMs = Number(next.duration_ms);
          i += 2;
        } else {
          i += 1;
        }
        cards.push(card);
        continue;
      }
      if (ev.event_type === "end" || ev.event_type === "error") {
        cards.push({
          key: String(ev.id),
          output: ev.event_type === "end" ? ev.output_payload : undefined,
          error: ev.event_type === "error" ? ev.error || "Node failed" : null,
          durationMs: ev.duration_ms != null ? Number(ev.duration_ms) : null,
          pending: false,
        });
      }
      i += 1;
    }
    return cards;
  }, [nodeDetail]);

  const runGraphSnapshot = useMemo(() => {
    const events = [...(activeRun?.events || [])].sort(
      (a, b) => Number(b.sequence_no ?? 0) - Number(a.sequence_no ?? 0)
    );
    for (const ev of events) {
      if (ev.event_type !== "end") continue;
      const snap = extractGraphSnapshot(ev.output_payload);
      if (snap) return snap;
    }
    return null;
  }, [activeRun?.events]);

  const livePathIoJson = useMemo(() => {
    if (!activeRun || liveSteps.length === 0) return null;
    const byId = new Map((activeRun.events || []).map((e) => [String(e.id), e]));
    const out: Record<string, { input: unknown; output: unknown }> = {};
    for (const step of liveSteps) {
      const events = step.eventIds
        .map((id) => byId.get(String(id)))
        .filter((e): e is GraphEvent => !!e);
      out[liveStepIoKey(step.stepIndex, step.nodeId)] = ioFromEvents(events);
    }
    return out;
  }, [activeRun, liveSteps]);

  const selectedStepIoJson = useMemo(() => {
    if (canvasMode === "live" && selectedStepKey) {
      const step = liveStepByKey.get(selectedStepKey);
      if (!step || !activeRun) return null;
      const idSet = new Set(step.eventIds.map(String));
      const events = (activeRun.events || []).filter((e) => idSet.has(String(e.id)));
      const io = ioFromEvents(events);
      return {
        step: step.stepIndex,
        node: step.label,
        input: io.input,
        output: io.output,
      };
    }
    if (!selectedNode || !nodeVisitCards.length) return null;
    const card = nodeVisitCards[0];
    return {
      step: null,
      node: humanize(selectedNode),
      input: card.input !== undefined ? card.input : null,
      output: card.output !== undefined ? card.output : null,
    };
  }, [
    canvasMode,
    selectedStepKey,
    liveStepByKey,
    activeRun,
    selectedNode,
    nodeVisitCards,
  ]);

  const flashCopyFeedback = (label: string) => {
    setCopyFeedback(label);
    window.setTimeout(() => setCopyFeedback(null), 2000);
  };

  const copySelectedStepIo = async () => {
    if (!selectedStepIoJson) return;
    try {
      await copyTextToClipboard(JSON.stringify(selectedStepIoJson, null, 2));
      flashCopyFeedback("Step I/O copied");
    } catch {
      setError("Failed to copy step I/O");
    }
  };

  const copyLivePathIo = async () => {
    if (!livePathIoJson) return;
    try {
      await copyTextToClipboard(JSON.stringify(livePathIoJson, null, 2));
      flashCopyFeedback("Live path I/O copied");
    } catch {
      setError("Failed to copy live path I/O");
    }
  };

  // Always surface awaiting prompts in the inspector while a run is paused —
  // even if the user clicked a different node for I/O inspection.
  const promptsForSelected = awaitingPrompts;

  const parsedPayload = useMemo(() => {
    if (!payloadDraft.trim()) return { value: null, error: "Payload is empty" };
    try {
      const value = JSON.parse(payloadDraft);
      if (!value || Array.isArray(value) || typeof value !== "object") {
        return { value: null, error: "Payload must be a JSON object" };
      }
      return { value: value as Record<string, unknown>, error: null };
    } catch (e: unknown) {
      return { value: null, error: errorMessage(e, "Invalid JSON") };
    }
  }, [payloadDraft]);

  const selectTopologyNode = (id: string | null) => {
    setSelectedStepKey(null);
    setSelectedNode(id);
    setShowInspector(!!id);
  };

  const selectLiveStep = (stepKey: string | null) => {
    if (!stepKey) {
      setSelectedStepKey(null);
      setSelectedNode(null);
      setShowInspector(false);
      return;
    }
    const step = liveStepByKey.get(stepKey);
    setSelectedStepKey(stepKey);
    setSelectedNode(step?.nodeId ?? null);
    setShowInspector(true);
  };

  const applyRunResult = (result: ActiveGraphRun) => {
    setActiveRun(result);
    setAnswerDrafts({});
    const prompts: AwaitingPrompt[] = result?.awaiting_input?.awaiting
      ? result.awaiting_input.prompts || []
      : [];
    const waitNode = prompts[0]?.node_id;
    const runPath = (result?.run?.path as string[]) || [];
    const completed =
      result?.run?.status === "completed" ||
      (!prompts.length && !!result?.run?.final_state && runPath.length > 0);

    if (runPath.length > 0) {
      const lastIdx = runPath.length - 1;
      const lastId = runPath[lastIdx];
      const stepKey = liveStepKey(lastIdx + 1, lastId);
      setSelectedStepKey(stepKey);
      // Prefer the waiting node; otherwise the last executed step (not END —
      // live mode has no END card, and topology users can click END).
      setSelectedNode(waitNode || lastId);
      setShowInspector(true);
      return;
    }

    const pick = waitNode || (completed ? END_NODE_ID : null);
    setSelectedStepKey(null);
    if (pick) {
      setSelectedNode(pick);
      setShowInspector(true);
    }
  };

  const openReplayEditor = async () => {
    const runId = activeRun?.run?.id;
    if (!runId || !selectedNode || isEndNodeId(selectedNode)) return;
    setPayloadBusy(true);
    setPayloadError(null);
    try {
      const result = await adminApi.nodeInput(runId, selectedNode);
      setOriginalPayload(result.payload);
      setPayloadDraft(JSON.stringify(result.payload, null, 2));
      setShowReplayEditor(true);
    } catch (e: unknown) {
      setPayloadError(errorMessage(e, "Unable to load this node input"));
      setShowReplayEditor(true);
    } finally {
      setPayloadBusy(false);
    }
  };

  const generatePayload = async () => {
    if (!selectedNode || !parsedPayload.value || !payloadPrompt.trim()) return;
    setPayloadBusy(true);
    setPayloadError(null);
    try {
      const result = await adminApi.generateNodePayload({
        graph_id: graphId,
        node_id: selectedNode,
        prompt: payloadPrompt,
        base_payload: parsedPayload.value,
        provider: payloadProvider,
        model: payloadModel,
      });
      setPayloadDraft(JSON.stringify(result.payload, null, 2));
    } catch (e: unknown) {
      setPayloadError(errorMessage(e, "Payload generation failed"));
    } finally {
      setPayloadBusy(false);
    }
  };

  const forkFromNode = async () => {
    const runId = activeRun?.run?.id;
    if (!runId || !selectedNode || !parsedPayload.value) return;
    const confirmed = window.confirm(
      `Fork and execute ${humanize(selectedNode)} with this payload? ` +
        "The node may perform real database or external-service side effects."
    );
    if (!confirmed) return;
    setPayloadBusy(true);
    setPayloadError(null);
    try {
      const result = await adminApi.forkRun(runId, {
        node_id: selectedNode,
        payload: parsedPayload.value,
      });
      setShowReplayEditor(false);
      applyRunResult(result);
      await load();
    } catch (e: unknown) {
      setPayloadError(errorMessage(e, "Replay failed"));
    } finally {
      setPayloadBusy(false);
    }
  };

  const runTest = async (overrideQuery?: string) => {
    setBusy(true);
    setError(null);
    setSelectedNode(null);
    setSelectedStepKey(null);
    try {
      if (isClashGraph) {
        const title = clashTitle.trim() || "Matter";
        const facts = (overrideQuery ?? clashFacts).trim();
        if (facts.length < 10) {
          setError("Clash Mode needs case facts (at least 10 characters), same as /clash.");
          setBusy(false);
          return;
        }
        if (overrideQuery != null) setClashFacts(facts);
        const initial_state: Record<string, unknown> = {
          mode: clashMode,
          user_role: clashRole,
          case_title: title,
          case_facts: facts,
          mock_case_id: clashMode === "practice" ? clashMockId : null,
        };
        const result = await adminApi.createRun({
          graph_id: graphId,
          query: facts,
          initial_state,
        });
        applyRunResult(result);
        await load();
        return;
      }

      const q = (overrideQuery ?? query).trim();
      if (!q) {
        setError("Enter a query (or use the mic) to run the graph");
        setBusy(false);
        return;
      }
      if (overrideQuery != null) setQuery(q);
      const initial_state = runInitialState
        ? {
            ...runInitialState,
            location: runInitialState.location,
            user_details: {
              user_id: "admin-test",
              ...((runInitialState.user_details as Record<string, unknown>) || {}),
              location:
                (runInitialState.user_details as Record<string, unknown> | undefined)?.location ||
                runInitialState.location,
            },
          }
        : undefined;
      const result = await adminApi.createRun({ graph_id: graphId, query: q, initial_state });
      applyRunResult(result);
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to run graph"));
    } finally {
      setBusy(false);
    }
  };

  const resumeTest = async (overrideMessage?: string, opts?: { delegate?: boolean }) => {
    const runId = activeRun?.run?.id;
    if (!runId || !awaitingPrompts.length) return;
    const answers: Record<string, string> = {};
    for (const p of awaitingPrompts) {
      const v = (answerDrafts[p.id] || "").trim();
      if (v) answers[p.id] = v;
    }
    const override = (overrideMessage || "").trim();
    if (override && awaitingPrompts[0]?.id) {
      answers[awaitingPrompts[0].id] = override;
    }
    if (opts?.delegate) {
      answers.delegate = "true";
    }
    const message =
      opts?.delegate
        ? "__delegate__"
        : override ||
          Object.values(answers).find((v) => v !== "true") ||
          (answerDrafts.__freeform || "").trim();
    if (!message && !opts?.delegate) {
      setError("Enter an answer to continue the run");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.resumeRun(runId, {
        message: message || "__delegate__",
        answers,
      });
      applyRunResult(result);
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to resume graph"));
    } finally {
      setBusy(false);
    }
  };

  const handleVoiceTranscription = (text: string, mode: "dictation" | "conversation") => {
    const t = text.trim();
    if (!t) return;
    // While a run is waiting for answers, fill the current prompt draft.
    if (awaitingPrompts.length > 0) {
      const promptId = awaitingPrompts[0]?.id || "__freeform";
      setAnswerDrafts((prev) => ({
        ...prev,
        [promptId]: mode === "dictation" && prev[promptId] ? `${prev[promptId]} ${t}` : t,
        __freeform: t,
      }));
      if (mode === "conversation") void resumeTest(t);
      return;
    }
    // Same as cases chat: dictation fills the query; conversation sends it.
    if (mode === "dictation") {
      if (isClashGraph) {
        setClashFacts((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t));
      } else {
        setQuery((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t));
      }
      return;
    }
    void runTest(t);
  };

  const openRun = async (id: string) => {
    setBusy(true);
    setShowRuns(false);
    try {
      const result = await adminApi.run(id);
      applyRunResult(result);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to open run"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-black">
      {/* Toolbar — Clash uses the same intake as /clash (practice / real life) */}
      <div className="flex shrink-0 flex-col border-b border-white/10">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
          <select
            className={`${adminSelect} !h-8 !rounded-lg !px-2 !py-0 !text-xs`}
            value={graphId}
            onChange={(e) => {
              setGraphId(e.target.value);
              setActiveRun(null);
              setSelectedNode(null);
              setSelectedStepKey(null);
              if (e.target.value === "clash_agent") setShowClashSetup(true);
            }}
            title="Graph"
          >
            {graphs.map((g) => (
              <option key={g.graph_id} value={g.graph_id}>
                {g.display_name || g.graph_id}
              </option>
            ))}
          </select>

          {isClashGraph ? (
            <>
              <div className="flex h-8 overflow-hidden rounded-lg border border-white/15">
                {(
                  [
                    ["practice", "Practice"],
                    ["real_life", "Real Life"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setClashMode(value);
                      if (value === "real_life") setClashMockId(null);
                    }}
                    className={cn(
                      "px-2.5 text-[11px] font-semibold",
                      clashMode === value
                        ? "bg-amber-500/90 text-black"
                        : "bg-zinc-900 text-white/70 hover:bg-zinc-800"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex h-8 overflow-hidden rounded-lg border border-white/15">
                {(
                  [
                    ["prosecution", "Prosecutor"],
                    ["defence", "Defence"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setClashRole(value)}
                    className={cn(
                      "px-2.5 text-[11px] font-semibold",
                      clashRole === value
                        ? "bg-sky-400 text-black"
                        : "bg-zinc-900 text-white/70 hover:bg-zinc-800"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`${adminBtnSecondary} !h-8 !rounded-lg !px-2 !text-[11px]`}
                onClick={() => setShowClashSetup((v) => !v)}
              >
                {showClashSetup ? "Collapse case" : "Case setup"}
              </button>
              <button
                type="button"
                disabled={busy || clashFacts.trim().length < 10}
                onClick={() => void runTest()}
                className={`${adminBtnPrimary} !h-8 !rounded-lg !px-3 !text-xs`}
              >
                {busy ? "…" : "Start debate"}
              </button>
            </>
          ) : (
            <>
              <input
                className={`${adminInput} !h-8 min-w-[160px] flex-1 !rounded-lg !px-2 !py-0 !text-xs`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Test query… (or use mic — Sarvam auto-detects language)"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void runTest();
                  }
                }}
              />
              <VoiceInput
                variant="admin"
                isProcessing={busy}
                onTranscription={(text, mode) => handleVoiceTranscription(text, mode)}
              />
              {presets.slice(0, 2).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="hidden h-8 rounded-lg bg-zinc-800 px-2 text-[11px] font-medium text-white/80 hover:bg-zinc-700 lg:inline"
                  onClick={() => {
                    setQuery(p.query);
                    const loc = (p.initial_state as Record<string, unknown> | undefined)?.location;
                    if (loc && typeof loc === "object") {
                      setRunInitialState({
                        location: loc as Record<string, unknown>,
                        user_details: { location: loc as Record<string, unknown> },
                      });
                    }
                  }}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                disabled={busy || !query.trim()}
                onClick={() => void runTest()}
                className={`${adminBtnPrimary} !h-8 !rounded-lg !px-3 !text-xs`}
              >
                {busy ? "…" : "Run"}
              </button>
            </>
          )}

          <button
            type="button"
            className={`${adminBtnSecondary} !h-8 !rounded-lg !px-2 !text-[11px]`}
            onClick={() => setShowRuns((v) => !v)}
          >
            Runs
          </button>

          <div className="flex h-8 overflow-hidden rounded-lg border border-white/15">
            {(
              [
                ["topology", "Topology"],
                ["live", "Live nodes"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setCanvasMode(value);
                  if (value === "topology") {
                    setSelectedStepKey(null);
                  } else if (liveSteps.length > 0) {
                    const last = liveSteps[liveSteps.length - 1];
                    setSelectedStepKey(last.stepKey);
                    setSelectedNode(last.nodeId);
                  }
                }}
                className={cn(
                  "px-2.5 text-[11px] font-semibold",
                  canvasMode === value
                    ? "bg-emerald-500 text-black"
                    : "bg-zinc-900 text-white/70 hover:bg-zinc-800"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {livePathIoJson && (!isClashGraph || debugEvents) ? (
            <button
              type="button"
              title="Copy all live-step input/output as JSON"
              className={`${adminBtnSecondary} !h-8 !rounded-lg !px-2 !text-[11px]`}
              onClick={() => void copyLivePathIo()}
            >
              <span className="inline-flex items-center gap-1">
                <Copy className="h-3 w-3" />
                {copyFeedback === "Live path I/O copied" ? "Copied" : "Copy live JSON"}
              </span>
            </button>
          ) : null}

          {isClashGraph ? (
            <button
              type="button"
              title="Show full per-node event I/O (debug)"
              className={cn(
                adminBtnSecondary,
                "!h-8 !rounded-lg !px-2 !text-[11px]",
                debugEvents && "!border-amber-500/40 !text-amber-100"
              )}
              onClick={() => setDebugEvents((v) => !v)}
            >
              {debugEvents ? "Debug I/O on" : "Debug I/O"}
            </button>
          ) : null}

          {path.length > 0 && (
            <div className="admin-scrollbar flex max-w-[40%] items-center gap-0.5 overflow-x-auto">
              {path.map((id, i) => {
                const stepKey = liveStepKey(i + 1, id);
                const active =
                  canvasMode === "live"
                    ? selectedStepKey === stepKey
                    : selectedNode === id && !selectedStepKey;
                return (
                  <button
                    key={stepKey}
                    type="button"
                    title={humanize(id)}
                    onClick={() => {
                      if (canvasMode === "live") {
                        selectLiveStep(stepKey);
                      } else {
                        selectTopologyNode(id);
                      }
                    }}
                    className={cn(
                      "h-6 shrink-0 rounded px-1.5 text-[10px] font-bold",
                      active
                        ? "bg-sky-400 text-black"
                        : failedNodes.has(id)
                          ? "bg-red-500 text-white"
                          : "bg-emerald-500 text-black"
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isClashGraph && (
          <div className="border-t border-white/[0.07] bg-[#050505]">
            <button
              type="button"
              onClick={() => setShowClashSetup((v) => !v)}
              aria-expanded={showClashSetup}
              className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
            >
              {showClashSetup ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/40" />
              )}
              <span className={cn(testerSectionLabel, "min-w-0 flex-1 truncate !normal-case tracking-[0.08em]")}>
                Clash intake · {clashMode === "practice" ? "Practice courtroom" : "Real life case"} ·
                you play {clashRole === "defence" ? "Defence" : "Prosecutor"}
                {!showClashSetup && clashTitle.trim() ? ` · ${clashTitle.trim()}` : ""}
              </span>
            </button>
            {showClashSetup && (
              <div className="space-y-2 px-3 pb-3">
                {clashMode === "practice" && clashMockCases.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {clashMockCases.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setClashMockId(c.id);
                          setClashTitle(c.title);
                          setClashFacts(c.facts);
                        }}
                        className={cn(
                          "max-w-[220px] truncate rounded-xl border px-2.5 py-1.5 text-left text-[11px] transition",
                          clashMockId === c.id
                            ? "border-emerald-500/40 bg-emerald-600/15 text-emerald-50"
                            : "border-white/[0.1] bg-white/[0.03] text-white/70 hover:border-white/[0.18] hover:bg-white/[0.06]"
                        )}
                        title={c.summary}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <input
                    className={`${adminInput} !h-8 !rounded-xl !px-2 !py-0 !text-xs`}
                    value={clashTitle}
                    onChange={(e) => setClashTitle(e.target.value)}
                    placeholder={
                      clashMode === "real_life" ? "Brief title of your incident" : "Case title"
                    }
                  />
                  <textarea
                    className={`${adminInput} admin-scrollbar !min-h-[64px] !rounded-xl !px-2 !py-1.5 !text-xs`}
                    value={clashFacts}
                    onChange={(e) => setClashFacts(e.target.value)}
                    placeholder={
                      clashMode === "real_life"
                        ? "Describe what happened (dates, parties, amounts…)"
                        : "Case facts both sides will debate…"
                    }
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 px-2 py-1">
          <AdminErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* Graph fills the rest of the screen */}
      <div className="relative min-h-0 flex-1">
        {showRuns && (
          <aside className={cn(testerAsideShell, "left-0 w-60 border-r")}>
            <div className={testerAsideHeader}>
              <p className={testerSectionLabel}>Runs</p>
              <button
                type="button"
                className="text-[11px] text-white/40 hover:text-white"
                onClick={() => setShowRuns(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-1.5 p-3">
              {runs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] px-3 py-4 text-center text-[11px] text-white/40">
                  No runs yet for this graph.
                </p>
              ) : (
                runs.map((r) => {
                  const active = activeRun?.run?.id === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => void openRun(r.id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2.5 text-left transition",
                        active
                          ? "border-emerald-500/35 bg-emerald-600/15 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.2)]"
                          : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.06]"
                      )}
                    >
                      <p className="line-clamp-2 text-[11px] font-medium text-white">
                        {r.query || r.id}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-[10px] uppercase tracking-wider",
                          r.status === "failed"
                            ? "text-red-300/80"
                            : r.status === "completed" || r.status === "awaiting_input"
                              ? "text-emerald-300/70"
                              : "text-white/35"
                        )}
                      >
                        {r.status || "unknown"}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        )}

        <div className="absolute inset-0 [&_.react-flow__attribution]:hidden">
          <ReactFlowProvider>
            <FlowCanvas
              nodes={canvasNodes}
              edges={canvasEdges}
              graphKey={canvasGraphKey}
              mode={canvasMode}
              onSelect={(id) => {
                if (canvasMode === "live") {
                  selectLiveStep(id || null);
                } else {
                  selectTopologyNode(id || null);
                }
              }}
            />
          </ReactFlowProvider>
        </div>

        {showInspector && selectedNode && (
          <aside
            className={cn(
              testerAsideShell,
              "right-0 border-l transition-[width] duration-200",
              showReplayEditor ? "w-[min(560px,calc(100%-1rem))]" : "w-[320px]"
            )}
          >
            <div className={testerAsideHeader}>
              <div className="min-w-0">
                <p className={testerSectionLabel}>
                  {canvasMode === "live" && selectedStepKey
                    ? `Step ${liveStepByKey.get(selectedStepKey)?.stepIndex ?? "—"}`
                    : "Node"}
                </p>
                <p className="truncate text-sm font-semibold text-white">
                  {selectedNode ? humanize(selectedNode) : "—"}
                </p>
                {activeRun?.run?.parent_run_id ? (
                  <p className="truncate text-[9px] text-emerald-300/60">
                    Fork of {String(activeRun.run.parent_run_id).slice(0, 8)}
                    {activeRun.run.fork_node_id ? ` · from ${humanize(activeRun.run.fork_node_id)}` : ""}
                  </p>
                ) : null}
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-1.5">
                {selectedStepIoJson ? (
                  <button
                    type="button"
                    title="Copy this step's input/output JSON"
                    className={testerIconBtn}
                    onClick={() => void copySelectedStepIo()}
                  >
                    <Copy className="h-3 w-3" />
                    {copyFeedback === "Step I/O copied" ? "Copied" : "Copy I/O"}
                  </button>
                ) : null}
                {!isEndNodeId(selectedNode) && activeRun?.run?.id ? (
                  <button
                    type="button"
                    disabled={payloadBusy}
                    className={cn(
                      testerIconBtn,
                      "border-emerald-500/25 bg-emerald-600/10 text-emerald-200 hover:bg-emerald-600/20"
                    )}
                    onClick={() =>
                      showReplayEditor ? setShowReplayEditor(false) : void openReplayEditor()
                    }
                  >
                    {showReplayEditor ? "Hide editor" : payloadBusy ? "Loading…" : "Edit & replay"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-xl px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                  onClick={() => setShowInspector(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="space-y-2.5 p-3">
              {runGraphSnapshot ? (
                <GraphSnapshotPane snapshot={runGraphSnapshot} title="Run snapshot · plan / flags / suggestions" />
              ) : null}
              {showReplayEditor && !isEndNodeId(selectedNode) && (
                <div className={cn(testerPanel, "border-emerald-500/25 bg-emerald-950/20")}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className={cn(testerSectionLabel, "!text-emerald-300/80")}>
                        Input payload workbench
                      </p>
                      <p className="mt-0.5 text-[10px] text-white/45">
                        This is the checkpoint state immediately before the selected node.
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={!originalPayload}
                        className={testerIconBtn}
                        onClick={() =>
                          originalPayload && setPayloadDraft(JSON.stringify(originalPayload, null, 2))
                        }
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        disabled={!payloadDraft}
                        className={testerIconBtn}
                        onClick={() => void navigator.clipboard.writeText(payloadDraft)}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        disabled={!parsedPayload.value}
                        className={testerIconBtn}
                        onClick={() =>
                          parsedPayload.value &&
                          setPayloadDraft(JSON.stringify(parsedPayload.value, null, 2))
                        }
                      >
                        Format
                      </button>
                    </div>
                  </div>

                  <textarea
                    className="admin-scrollbar mt-2 min-h-[260px] w-full resize-y rounded-xl border border-white/[0.1] bg-black/50 p-2.5 font-mono text-[10px] leading-relaxed text-emerald-100/90 outline-none transition focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25"
                    value={payloadDraft}
                    spellCheck={false}
                    onChange={(e) => setPayloadDraft(e.target.value)}
                    placeholder="Loading node input…"
                  />
                  {parsedPayload.error ? (
                    <p className="mt-1 text-[10px] text-red-300">{parsedPayload.error}</p>
                  ) : (
                    <p className="mt-1 text-[10px] text-emerald-300/80">Valid JSON object</p>
                  )}

                  {modelSnapshot ? (
                    <div className={cn(testerPanel, "mt-3")}>
                      <AdminModelSelector
                        compact
                        label="Regenerate entire payload with AI"
                        provider={payloadProvider}
                        model={payloadModel}
                        catalog={modelSnapshot.catalog}
                        env={modelSnapshot.env}
                        onChange={(provider, model) => {
                          setPayloadProvider(provider);
                          setPayloadModel(model);
                        }}
                      />
                      <textarea
                        className={`${adminInput} mt-2 !min-h-[76px] !rounded-xl !px-2 !py-1.5 !text-xs`}
                        value={payloadPrompt}
                        onChange={(e) => setPayloadPrompt(e.target.value)}
                        placeholder="Describe the exact scenario/state you want, e.g. authenticated Delhi user with a completed UPI fraud intake…"
                      />
                      <button
                        type="button"
                        disabled={
                          payloadBusy || !payloadPrompt.trim() || !parsedPayload.value
                        }
                        onClick={() => void generatePayload()}
                        className={`${adminBtnSecondary} mt-2 !h-8 !w-full !rounded-xl !text-xs`}
                      >
                        {payloadBusy ? "Generating…" : "Generate payload"}
                      </button>
                    </div>
                  ) : null}

                  {payloadError ? (
                    <p className="mt-2 whitespace-pre-wrap rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-200">
                      {payloadError}
                    </p>
                  ) : null}
                  <p className="mt-3 text-[10px] text-amber-200/70">
                    Replay executes this node and all downstream nodes. Real side effects may run.
                  </p>
                  <button
                    type="button"
                    disabled={payloadBusy || !parsedPayload.value}
                    onClick={() => void forkFromNode()}
                    className={`${adminBtnPrimary} mt-2 !h-9 !w-full !rounded-xl !text-xs`}
                  >
                    {payloadBusy ? "Running…" : `Fork & rerun from ${humanize(selectedNode)}`}
                  </button>
                </div>
              )}

              {(() => {
                const loc =
                  (finalPayload?.location as Record<string, unknown> | undefined) ||
                  ((finalPayload?.user_details as Record<string, unknown> | undefined)?.location as
                    | Record<string, unknown>
                    | undefined);
                if (!loc || (!loc.city && !loc.state && loc.lat == null)) return null;
                return (
                  <div className={testerPanel}>
                    <p className={testerSectionLabel}>Case location</p>
                    <p className="mt-1.5 text-xs text-white">
                      {[loc.city, loc.state].filter(Boolean).join(", ") || "—"}
                      {loc.source ? ` · ${String(loc.source)}` : ""}
                    </p>
                    {loc.lat != null && loc.lon != null ? (
                      <p className="mt-0.5 font-mono text-[10px] text-white/45">
                        {String(loc.lat)}, {String(loc.lon)}
                      </p>
                    ) : null}
                  </div>
                );
              })()}

              {selectedNode && isEndNodeId(selectedNode) && (
                <div className={testerPanel}>
                  <p className={testerSectionLabel}>Final graph payload</p>
                  <p className="mt-1.5 text-[11px] text-white/45">
                    Entire checkpoint state after the run reached END
                    {activeRun?.run?.status ? ` · status ${activeRun.run.status}` : ""}.
                  </p>
                  {finalPayload ? (
                    <ThemeJsonBlock value={finalPayload} tone="neutral" maxHeightClass="max-h-[70vh]" />
                  ) : (
                    <p className="mt-2 text-xs text-amber-200/80">
                      No final_state yet — run a test to completion.
                    </p>
                  )}
                </div>
              )}

              {isClashGraph && finalPayload ? (
                <div className={testerPanel}>
                  <p className={testerSectionLabel}>Clash checkpoint monitor</p>
                  <p className="mt-1 text-[10px] text-white/40">
                    Judgments and pause prompts from checkpoint state (not truncated event I/O).
                  </p>
                  {finalPayload.round_scores ? (
                    <div className="mt-2.5">
                      <p className={cn(testerSectionLabel, "!text-emerald-300/70")}>round_scores</p>
                      <ThemeJsonBlock
                        value={finalPayload.round_scores}
                        tone="output"
                        maxHeightClass="max-h-40"
                      />
                    </div>
                  ) : null}
                  {finalPayload.final_result ? (
                    <div className="mt-2.5">
                      <p className={cn(testerSectionLabel, "!text-emerald-300/70")}>final_result</p>
                      <ThemeJsonBlock
                        value={finalPayload.final_result}
                        tone="output"
                        maxHeightClass="max-h-56"
                      />
                    </div>
                  ) : null}
                  {finalPayload.pending_question || awaitingPrompts[0]?.label ? (
                    <div className="mt-2.5">
                      <p className={cn(testerSectionLabel, "!text-amber-300/70")}>pause prompt</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-white">
                        {String(finalPayload.pending_question || awaitingPrompts[0]?.label || "")}
                      </p>
                    </div>
                  ) : null}
                  {!finalPayload.round_scores &&
                  !finalPayload.final_result &&
                  !finalPayload.pending_question &&
                  !awaitingPrompts.length ? (
                    <p className="mt-2 text-[11px] text-white/40">
                      No scores or pause yet — continue the run.
                    </p>
                  ) : null}
                  {!debugEvents ? (
                    <p className="mt-2 text-[10px] text-white/35">
                      Enable Debug I/O for full per-node event payloads.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {promptsForSelected.length > 0 && (
                <div className={cn(testerPanel, "border-amber-500/30 bg-amber-950/25")}>
                  <p className={cn(testerSectionLabel, "!text-amber-200/80")}>
                    User input required
                    {promptsForSelected[0]?.total != null
                      ? ` · ${Number(promptsForSelected[0].index ?? 0) + 1}/${promptsForSelected[0].total}`
                      : ""}
                  </p>
                  {promptsForSelected.map((p) => (
                    <div key={p.id} className="mt-2.5">
                      <p className="whitespace-pre-wrap text-xs font-medium leading-relaxed text-white">
                        {p.label}
                      </p>
                      {p.hint ? (
                        <p className="mt-1 text-[11px] italic text-white/45">{p.hint}</p>
                      ) : null}
                      {p.kind === "choice" && p.choices?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.choices.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              disabled={busy}
                              className={cn(
                                "rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition",
                                answerDrafts[p.id] === c.id
                                  ? "border-emerald-500/40 bg-emerald-600/20 text-emerald-100"
                                  : "border-white/[0.12] bg-white/[0.04] text-white/75 hover:border-white/[0.2] hover:bg-white/[0.07]"
                              )}
                              onClick={() => {
                                setAnswerDrafts((prev) => ({ ...prev, [p.id]: c.id }));
                              }}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 flex items-start gap-2">
                          <textarea
                            className={`${adminInput} !min-h-[72px] min-w-0 flex-1 !rounded-xl !px-2 !py-1.5 !text-xs`}
                            value={answerDrafts[p.id] || ""}
                            onChange={(e) =>
                              setAnswerDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            placeholder={
                              p.kind === "moderator_options"
                                ? "File FIR, Contact cyber cell, …"
                                : p.kind === "moderator_response"
                                  ? "Moderator guidance for the user…"
                                  : "Type answer… (or use mic)"
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void resumeTest();
                              }
                            }}
                          />
                          <VoiceInput
                            variant="admin"
                            isProcessing={busy}
                            onTranscription={(text, mode) => {
                              const t = text.trim();
                              if (!t) return;
                              setAnswerDrafts((prev) => ({
                                ...prev,
                                [p.id]:
                                  mode === "dictation" && prev[p.id]
                                    ? `${prev[p.id]} ${t}`
                                    : t,
                                __freeform: t,
                              }));
                              if (mode === "conversation") void resumeTest(t);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resumeTest()}
                      className={`${adminBtnPrimary} !h-8 !w-full !rounded-xl !text-xs`}
                    >
                      {busy ? "…" : "Submit & continue"}
                    </button>
                    {isClashGraph &&
                      promptsForSelected.some((p) => p.ai_assist_allowed) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resumeTest(undefined, { delegate: true })}
                          className={`${adminBtnSecondary} !h-8 !w-full !rounded-xl !text-xs`}
                        >
                          Let AI counsel handle this
                        </button>
                      )}
                  </div>
                </div>
              )}

              {selectedNode &&
                !isEndNodeId(selectedNode) &&
                !nodeDetail?.length &&
                !promptsForSelected.length &&
                (!isClashGraph || debugEvents) && (
                  <p className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/85">
                    No events for this node in the current run.
                  </p>
                )}

              {(!isClashGraph || debugEvents) && nodeVisitCards.length > 1 ? (
                <p className="text-[10px] text-white/40">
                  {nodeVisitCards.length} visits in this run — each card is one enter→finish cycle.
                </p>
              ) : null}

              {(!isClashGraph || debugEvents) &&
                nodeVisitCards.map((card, visitIdx) => (
                <div key={card.key} className={testerPanel}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        testerChip,
                        "bg-emerald-600/20 text-emerald-200 ring-1 ring-emerald-500/25"
                      )}
                    >
                      {nodeVisitCards.length > 1 ? `Visit ${visitIdx + 1}` : "I/O"}
                    </span>
                    {card.pending ? (
                      <span
                        className={cn(
                          testerChip,
                          "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30"
                        )}
                      >
                        entered · no finish yet
                      </span>
                    ) : card.error ? (
                      <span
                        className={cn(
                          testerChip,
                          "bg-red-500/15 text-red-200 ring-1 ring-red-400/30"
                        )}
                      >
                        failed
                      </span>
                    ) : (
                      <span
                        className={cn(
                          testerChip,
                          "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
                        )}
                      >
                        finished
                      </span>
                    )}
                    {card.durationMs != null ? (
                      <span className="ml-auto font-mono text-[10px] text-white/40">
                        {card.durationMs.toFixed(0)}ms
                      </span>
                    ) : null}
                  </div>
                  {visitIdx === 0 ? (
                    <p className="mt-2 text-[10px] leading-relaxed text-white/40">
                      Traced as enter → finish. Input is state when the node started; output is its
                      return value (e.g. <code className="text-white/55">__end__</code> means it
                      routed to END — not a missing payload).
                    </p>
                  ) : null}
                  {card.error ? (
                    <ThemeJsonBlock value={card.error} tone="error" maxHeightClass="max-h-24" />
                  ) : null}
                  {card.input !== undefined ? (
                    <div className="mt-2.5">
                      <p className={cn(testerSectionLabel, "!text-sky-300/70")}>
                        Input · state at enter
                      </p>
                      <ThemeJsonBlock value={card.input} tone="input" />
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-white/40">No enter payload recorded.</p>
                  )}
                  {card.output !== undefined ? (
                    <div className="mt-2.5">
                      <p className={cn(testerSectionLabel, "!text-emerald-300/70")}>
                        Output · return value
                      </p>
                      {extractGraphSnapshot(card.output) ? (
                        <GraphSnapshotPane
                          snapshot={extractGraphSnapshot(card.output)!}
                          title="Node snapshot"
                        />
                      ) : null}
                      <ThemeJsonBlock value={card.output} tone="output" />
                      {card.output === "__end__" ||
                      (typeof card.output === "string" && isEndNodeId(card.output)) ? (
                        <p className="mt-1.5 text-[10px] text-emerald-300/70">
                          Routed the graph to END (pause or finish).
                        </p>
                      ) : null}
                    </div>
                  ) : card.pending ? (
                    <p className="mt-2 text-[11px] text-amber-200/80">
                      No finish event yet — common when the run paused for user input on this node.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-white/40">No return value recorded.</p>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}

        {awaitingPrompts.length > 0 && !showInspector && (
          <div
            className={cn(
              "absolute bottom-3 left-1/2 z-20 w-[min(520px,calc(100%-1.5rem))] -translate-x-1/2",
              "rounded-2xl border border-amber-500/30 bg-[#030303]/95 p-3.5",
              "shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-sm"
            )}
          >
            <p className={cn(testerSectionLabel, "!text-amber-200/80")}>Waiting for user input</p>
            <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-white">
              {awaitingPrompts[0]?.label}
            </p>
            <div className="mt-2.5 flex gap-2">
              <input
                className={`${adminInput} !h-8 flex-1 !rounded-xl !px-2 !py-0 !text-xs`}
                value={answerDrafts[awaitingPrompts[0].id] || ""}
                onChange={(e) =>
                  setAnswerDrafts((prev) => ({
                    ...prev,
                    [awaitingPrompts[0].id]: e.target.value,
                  }))
                }
                placeholder="Answer…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void resumeTest();
                  }
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void resumeTest()}
                className={`${adminBtnPrimary} !h-8 !rounded-xl !px-3 !text-xs`}
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
