"use client";

/**
 * OpenUI Lang component library for the Improvise Policies studio.
 *
 * Two prompts are generated from this one library: `questionPrompt` steers the
 * model toward a clarification form, `impactPrompt` toward the analysis panel.
 * Everything renders in the dark admin theme so generated UI is indistinguishable
 * from hand-built admin screens.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { adminBtnPrimary, adminInput, adminSelect } from "@/components/admin/admin-ui";

const ACCENTS = {
  emerald: "text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.07]",
  amber: "text-amber-300 border-amber-500/25 bg-amber-500/[0.07]",
  red: "text-red-300 border-red-500/25 bg-red-500/[0.07]",
  blue: "text-sky-300 border-sky-500/25 bg-sky-500/[0.07]",
  violet: "text-violet-300 border-violet-500/25 bg-violet-500/[0.07]",
  neutral: "text-white/70 border-white/10 bg-white/[0.03]",
} as const;

type AccentName = keyof typeof ACCENTS;

const accentOf = (name?: string): string => ACCENTS[(name as AccentName) || "neutral"] || ACCENTS.neutral;

const CHART_COLORS = ["#10b981", "#38bdf8", "#f59e0b", "#a78bfa", "#ef4444", "#14b8a6"];

const tooltipStyle = {
  contentStyle: {
    background: "#0c0c0c",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    fontSize: 11,
  },
  labelStyle: { color: "rgba(255,255,255,0.65)" },
  itemStyle: { color: "#fff" },
};

// ---------------------------------------------------------------------------
// Answer plumbing — the generated form submits through React context rather
// than OpenUI actions, so answers survive re-parses during streaming.
// ---------------------------------------------------------------------------

type AnswerHandler = (answers: Record<string, string>) => void;

const PolicyGenUIContext = createContext<{ onSubmitAnswers?: AnswerHandler; busy?: boolean }>({});

export function PolicyGenUIProvider({
  onSubmitAnswers,
  busy,
  children,
}: {
  onSubmitAnswers?: AnswerHandler;
  busy?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ onSubmitAnswers, busy }), [onSubmitAnswers, busy]);
  return <PolicyGenUIContext.Provider value={value}>{children}</PolicyGenUIContext.Provider>;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const Stack = defineComponent({
  name: "Stack",
  description:
    "Root layout. Vertically stacks child components. Use direction 'row' only for two or three short items.",
  props: z.object({
    children: z.array(z.any()).describe("Child component references"),
    direction: z.enum(["column", "row"]).optional(),
    gap: z.enum(["s", "m", "l"]).optional(),
  }),
  component: ({ props, renderNode }) => {
    const gap = props.gap === "l" ? "gap-5" : props.gap === "s" ? "gap-2" : "gap-3";
    const dir = props.direction === "row" ? "flex-row flex-wrap items-stretch" : "flex-col";
    return (
      <div className={`flex ${dir} ${gap}`}>
        {(props.children || []).map((child, i) => (
          <div key={i} className={props.direction === "row" ? "min-w-[140px] flex-1" : undefined}>
            {renderNode(child)}
          </div>
        ))}
      </div>
    );
  },
});

const Section = defineComponent({
  name: "Section",
  description: "A titled group of content with an optional one-line description.",
  props: z.object({
    title: z.string(),
    children: z.array(z.any()),
    description: z.string().optional(),
  }),
  component: ({ props, renderNode }) => (
    <section className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4">
      <h3 className="text-sm font-semibold text-white/85">{props.title}</h3>
      {props.description ? (
        <p className="mt-1 text-xs leading-relaxed text-white/45">{props.description}</p>
      ) : null}
      <div className="mt-3 flex flex-col gap-3">
        {(props.children || []).map((child, i) => (
          <div key={i}>{renderNode(child)}</div>
        ))}
      </div>
    </section>
  ),
});

const Prose = defineComponent({
  name: "Prose",
  description: "A short paragraph of explanatory text. Two sentences maximum.",
  props: z.object({
    text: z.string(),
    tone: z.enum(["normal", "muted", "strong"]).optional(),
  }),
  component: ({ props }) => {
    const tone =
      props.tone === "strong"
        ? "text-white/85 font-medium"
        : props.tone === "muted"
          ? "text-white/40"
          : "text-white/65";
    return <p className={`text-xs leading-relaxed ${tone}`}>{props.text}</p>;
  },
});

// ---------------------------------------------------------------------------
// Metrics and charts
// ---------------------------------------------------------------------------

// Models routinely shift positional arguments and pass raw numbers, so the
// scalar props stay permissive: a coerced value renders, a rejected one drops
// the whole card.
const scalar = z.union([z.string(), z.number()]);

const MetricCard = defineComponent({
  name: "MetricCard",
  description:
    "A single headline number with a label and optional sub-caption. Exactly four positional arguments in this order: label, value, sub, accent.",
  props: z.object({
    label: z.string(),
    value: scalar,
    sub: scalar.optional(),
    accent: z.string().optional().describe("One of emerald, amber, red, blue, violet, neutral"),
  }),
  component: ({ props }) => (
    <div className={`rounded-2xl border p-4 ${accentOf(props.accent)}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">{props.label}</p>
      <p className="mt-1.5 text-xl font-semibold text-white">{props.value}</p>
      {props.sub ? <p className="mt-1 text-[11px] leading-snug text-white/40">{props.sub}</p> : null}
    </div>
  ),
});

const chartPoint = z.object({ name: z.string(), value: z.coerce.number() });

const Bars = defineComponent({
  name: "Bars",
  description: "Horizontal-reading bar chart for category counts. Keep to 10 points or fewer.",
  props: z.object({
    title: z.string(),
    data: z.array(chartPoint),
    color: z.enum(["emerald", "amber", "red", "blue", "violet"]).optional(),
  }),
  component: ({ props }) => {
    const data = (props.data || []).filter((d) => d && typeof d.value === "number");
    const fill =
      props.color === "amber"
        ? "#f59e0b"
        : props.color === "red"
          ? "#ef4444"
          : props.color === "blue"
            ? "#38bdf8"
            : props.color === "violet"
              ? "#a78bfa"
              : "#10b981";
    if (!data.length) return <EmptyChart title={props.title} />;
    return (
      <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/45">{props.title}</p>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={48}
              />
              <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} allowDecimals={false} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} {...tooltipStyle} />
              <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },
});

const Trend = defineComponent({
  name: "Trend",
  description: "Line chart for a value over time, such as daily case volume.",
  props: z.object({
    title: z.string(),
    data: z.array(chartPoint),
    caption: z.string().optional(),
  }),
  component: ({ props }) => {
    const data = (props.data || []).filter((d) => d && typeof d.value === "number");
    if (!data.length) return <EmptyChart title={props.title} />;
    return (
      <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/45">{props.title}</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} minTickGap={16} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
        {props.caption ? <p className="mt-2 text-[11px] text-white/40">{props.caption}</p> : null}
      </div>
    );
  },
});

function EmptyChart({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-white/45">{title}</p>
      <p className="mt-3 text-xs text-white/35">No data in this period.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables and lists
// ---------------------------------------------------------------------------

const DataTable = defineComponent({
  name: "DataTable",
  description: "Compact table. Every row must have exactly as many cells as there are columns.",
  props: z.object({
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(scalar)),
    caption: z.string().optional(),
  }),
  component: ({ props }) => (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0c0c0c]">
      <p className="border-b border-white/[0.07] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-white/45">
        {props.title}
      </p>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#0c0c0c]">
            <tr>
              {(props.columns || []).map((col, i) => (
                <th key={i} className="whitespace-nowrap px-4 py-2 font-medium text-white/45">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(props.rows || []).map((row, i) => (
              <tr key={i} className="border-t border-white/[0.05]">
                {(row || []).map((cell, j) => (
                  <td key={j} className="px-4 py-2 align-top text-white/70">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.caption ? (
        <p className="border-t border-white/[0.05] px-4 py-2 text-[11px] text-white/35">{props.caption}</p>
      ) : null}
    </div>
  ),
});

const EntityList = defineComponent({
  name: "EntityList",
  description:
    "List of affected records — cases, users, lawyers or guides. Use for concrete examples, not aggregates.",
  props: z.object({
    title: z.string(),
    items: z.array(
      z.object({
        primary: z.string(),
        secondary: scalar.optional(),
        badge: scalar.optional(),
      })
    ),
    emptyLabel: z.string().optional(),
  }),
  component: ({ props }) => {
    const items = props.items || [];
    return (
      <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/45">{props.title}</p>
        {items.length === 0 ? (
          <p className="text-xs text-white/35">{props.emptyLabel || "Nothing matched."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item, i) => (
              <li key={i} className="flex items-start justify-between gap-3 border-b border-white/[0.05] pb-2 last:border-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block truncate text-xs text-white/80">{item.primary}</span>
                  {item.secondary ? (
                    <span className="block truncate text-[11px] text-white/40">{item.secondary}</span>
                  ) : null}
                </span>
                {item.badge ? (
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
                    {item.badge}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
});

const DiffTable = defineComponent({
  name: "DiffTable",
  description: "Before/after view of proposed configuration changes.",
  props: z.object({
    title: z.string(),
    changes: z.array(
      z.object({
        target: z.string(),
        before: z.string(),
        after: z.string(),
        reason: z.string().optional(),
      })
    ),
  }),
  component: ({ props }) => {
    const changes = props.changes || [];
    if (!changes.length) {
      return (
        <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/45">{props.title}</p>
          <p className="mt-3 text-xs text-white/35">No automatic configuration changes.</p>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/45">{props.title}</p>
        <ul className="flex flex-col gap-3">
          {changes.map((change, i) => (
            <li key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="font-mono text-[11px] text-white/70">{change.target}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <span className="rounded-md border border-red-500/25 bg-red-500/[0.08] px-1.5 py-0.5 text-red-300">
                  {change.before}
                </span>
                <span className="text-white/30">→</span>
                <span className="rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] px-1.5 py-0.5 text-emerald-300">
                  {change.after}
                </span>
              </p>
              {change.reason ? (
                <p className="mt-1.5 text-[11px] leading-snug text-white/45">{change.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  },
});

const RiskCallout = defineComponent({
  name: "RiskCallout",
  description: "Highlights a risk, caveat or manual follow-up the admin must act on.",
  props: z.object({
    title: z.string(),
    detail: z.string(),
    level: z.enum(["low", "medium", "high"]).optional(),
  }),
  component: ({ props }) => {
    const level = props.level || "medium";
    const accent = level === "high" ? ACCENTS.red : level === "low" ? ACCENTS.emerald : ACCENTS.amber;
    return (
      <div className={`rounded-2xl border p-4 ${accent}`}>
        <p className="flex items-center gap-2 text-xs font-semibold">
          <span className="rounded-full border border-current/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
            {level}
          </span>
          {props.title}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">{props.detail}</p>
      </div>
    );
  },
});

// ---------------------------------------------------------------------------
// Question form
// ---------------------------------------------------------------------------

const Question = defineComponent({
  name: "Question",
  description:
    "One question inside a QuestionForm. 'name' must be snake_case and unique. Provide options for select and radio.",
  props: z.object({
    name: z.string(),
    label: z.string(),
    kind: z.enum(["text", "textarea", "number", "select", "radio"]),
    options: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
  }),
  component: () => null,
});

type QuestionProps = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select" | "radio";
  options?: string[];
  placeholder?: string;
  help?: string;
};

function readQuestion(node: unknown): QuestionProps | null {
  const props = (node as { props?: QuestionProps })?.props;
  if (!props || !props.name || !props.label) return null;
  return { ...props, kind: props.kind || "text" };
}

const QuestionForm = defineComponent({
  name: "QuestionForm",
  description:
    "The clarification form. Contains three to six Question items and submits all answers at once.",
  props: z.object({
    title: z.string(),
    questions: z.array(Question.ref),
    submitLabel: z.string().optional(),
    intro: z.string().optional(),
  }),
  component: ({ props }) => {
    const { onSubmitAnswers, busy } = useContext(PolicyGenUIContext);
    const questions = (props.questions || []).map(readQuestion).filter(Boolean) as QuestionProps[];
    const [values, setValues] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);

    const set = (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value }));

    if (!questions.length) return null;

    return (
      <form
        className="rounded-2xl border border-white/[0.09] bg-[#0c0c0c] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!onSubmitAnswers || busy) return;
          const answers: Record<string, string> = {};
          questions.forEach((q) => {
            answers[q.label] = values[q.name] ?? "";
          });
          setSubmitted(true);
          onSubmitAnswers(answers);
        }}
      >
        <h3 className="text-sm font-semibold text-white/85">{props.title}</h3>
        {props.intro ? <p className="mt-1 text-xs leading-relaxed text-white/45">{props.intro}</p> : null}
        <div className="mt-4 flex flex-col gap-4">
          {questions.map((q) => (
            <div key={q.name}>
              <label htmlFor={`pq-${q.name}`} className="mb-1.5 block text-xs font-medium text-white/70">
                {q.label}
              </label>
              {q.kind === "textarea" ? (
                <textarea
                  id={`pq-${q.name}`}
                  rows={3}
                  className={`${adminInput} resize-y`}
                  placeholder={q.placeholder}
                  value={values[q.name] ?? ""}
                  onChange={(e) => set(q.name, e.target.value)}
                />
              ) : q.kind === "select" ? (
                <select
                  id={`pq-${q.name}`}
                  className={`${adminSelect} w-full`}
                  value={values[q.name] ?? ""}
                  onChange={(e) => set(q.name, e.target.value)}
                >
                  <option value="">Select…</option>
                  {(q.options || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : q.kind === "radio" ? (
                <div className="flex flex-wrap gap-2">
                  {(q.options || []).map((opt) => {
                    const active = (values[q.name] ?? "") === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set(q.name, opt)}
                        className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs transition ${
                          active
                            ? "border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-200"
                            : "border-white/[0.12] bg-white/[0.03] text-white/65 hover:bg-white/[0.06]"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  id={`pq-${q.name}`}
                  type={q.kind === "number" ? "number" : "text"}
                  className={adminInput}
                  placeholder={q.placeholder}
                  value={values[q.name] ?? ""}
                  onChange={(e) => set(q.name, e.target.value)}
                />
              )}
              {q.help ? <p className="mt-1 text-[11px] text-white/35">{q.help}</p> : null}
            </div>
          ))}
        </div>
        <button type="submit" className={`${adminBtnPrimary} mt-4 text-xs`} disabled={busy}>
          {busy && submitted ? "Refining…" : props.submitLabel || "Submit answers"}
        </button>
      </form>
    );
  },
});

// ---------------------------------------------------------------------------
// Library + prompts
// ---------------------------------------------------------------------------

export const policyGenUILibrary = createLibrary({
  id: "nyaysahayak-policy-studio",
  root: "Stack",
  components: [
    Stack,
    Section,
    Prose,
    MetricCard,
    Bars,
    Trend,
    DataTable,
    EntityList,
    DiffTable,
    RiskCallout,
    QuestionForm,
    Question,
  ],
});

const SHARED_RULES = [
  "The panel is narrow (about 420px). Never place more than two items in a row Stack.",
  "Never invent numbers. Every value must come from the data supplied in the user message.",
  "Keep all copy in plain English, short and factual. No marketing tone.",
  "Arguments are positional and in signature order. Never write name: value, and never skip a middle argument — pass null to leave one out.",
];

export function questionPrompt(): string {
  return policyGenUILibrary.prompt({
    preamble:
      "Build a single QuestionForm that collects the missing details needed to finalise a platform policy.",
    additionalRules: [
      ...SHARED_RULES,
      "root must be a Stack containing exactly one QuestionForm.",
      "Every Question name must be unique snake_case; every label must be a full question.",
      "Prefer radio or select over free text whenever the answer is one of a known set.",
    ],
    examples: [
      [
        'root = Stack([form])',
        'form = QuestionForm("A few details before I finalise this", [q1, q2], "Submit answers")',
        'q1 = Question("rollout_scope", "Should this apply to every state or only the pilot states?", "radio", ["All states", "Pilot states only"])',
        'q2 = Question("sla_minutes", "What SLA in minutes should moderators be held to?", "number", null, "e.g. 90")',
      ].join("\n"),
    ],
  });
}

export function impactPrompt(): string {
  return policyGenUILibrary.prompt({
    preamble:
      "Visualise how a proposed policy affects the existing user base, live cases and current configuration.",
    additionalRules: [
      ...SHARED_RULES,
      "root must be a Stack. Lead with headline MetricCards, then charts, then tables, then RiskCallouts.",
      "Use DiffTable for proposed configuration changes and RiskCallout for every manual follow-up.",
      "Do not emit QuestionForm or Question in the impact panel.",
    ],
    examples: [
      [
        'root = Stack([headline, volume, table, risk])',
        'headline = Stack([m1, m2], "row", "m")',
        'm1 = MetricCard("Cases affected", "1,284", "Last 30 days", "amber")',
        'm2 = MetricCard("Users affected", "9,410", "Across 12 states", "blue")',
        'volume = Bars("Cases by incident type", [{name: "cyber", value: 420}, {name: "civil", value: 260}])',
        'table = DataTable("Top affected states", ["State", "Cases"], [["Maharashtra", "310"], ["Bihar", "180"]])',
        'risk = RiskCallout("Moderator load rises", "Throughput must go from 12 to 18 cases per hour.", "medium")',
      ].join("\n"),
    ],
  });
}

export { CHART_COLORS };
