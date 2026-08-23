"use client";

import type { FinalClashResult, JudgeScore } from "@/lib/clashApi";
import {
  computeJudgmentWeights,
  MAX_CLASH_ROUNDS,
} from "@/lib/clashVerdictWeights";

const PROSECUTION_COLOR = "#34d399";
const DEFENCE_COLOR = "#fbbf24";

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function slicePath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  if (endDeg - startDeg >= 359.99) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y} Z`;
}

export function ClashVerdictPieChart({
  finalResult,
  roundScores,
  tone = "dark",
}: {
  finalResult: FinalClashResult;
  roundScores: JudgeScore[];
  /** dark = bench sidebar; light = judgment card on canvas */
  tone?: "dark" | "light";
}) {
  const weights = computeJudgmentWeights(finalResult, roundScores);
  const { prosecutionPct, defencePct, prosecution, defence } = weights;

  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const r = 46;

  const prosecutionEnd = (prosecutionPct / 100) * 360;
  const paths: { d: string; fill: string; label: string }[] = [];

  if (prosecutionPct > 0) {
    paths.push({
      d: slicePath(cx, cy, r, 0, prosecutionEnd),
      fill: PROSECUTION_COLOR,
      label: `Prosecution ${prosecutionPct}%`,
    });
  }
  if (defencePct > 0) {
    paths.push({
      d: slicePath(cx, cy, r, prosecutionEnd, 360),
      fill: DEFENCE_COLOR,
      label: `Defence ${defencePct}%`,
    });
  }

  const chartLabel = `Judgment weight: Prosecution ${prosecutionPct} percent, Defence ${defencePct} percent`;
  const light = tone === "light";

  return (
    <div
      className={
        light
          ? "rounded-lg border border-border bg-muted/40 p-2.5"
          : "rounded-lg border border-white/15 bg-white/10 p-2.5"
      }
    >
      <p
        className={
          light
            ? "mb-2 text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
            : "mb-2 text-center text-[9px] font-bold uppercase tracking-wider opacity-90"
        }
      >
        Judgment weight (3 rounds max)
      </p>
      <div className="flex flex-col items-center gap-2">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={chartLabel}
          className="drop-shadow-sm"
        >
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={light ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.08)"}
          />
          {paths.map((p) => (
            <path key={p.label} d={p.d} fill={p.fill} stroke="rgba(0,0,0,0.15)" strokeWidth={0.5}>
              <title>{p.label}</title>
            </path>
          ))}
          <circle cx={cx} cy={cy} r={22} fill="#00634B" />
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            className="fill-white text-[9px] font-bold"
            style={{ fontSize: 9 }}
          >
            Bench
          </text>
          <text
            x={cx}
            y={cy + 9}
            textAnchor="middle"
            className="fill-white/80"
            style={{ fontSize: 7 }}
          >
            split
          </text>
        </svg>

        <ul
          className={
            light
              ? "w-full space-y-1 text-[10px] text-foreground"
              : "w-full space-y-1 text-[10px]"
          }
          aria-hidden={false}
        >
          <li className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: PROSECUTION_COLOR }}
              />
              <span className="truncate opacity-95">Prosecution</span>
            </span>
            <span className="shrink-0 font-bold tabular-nums">{prosecutionPct}%</span>
          </li>
          <li className="flex items-center justify-between gap-2 pl-4 text-[9px] opacity-80">
            <span className="truncate">avg {prosecution.toFixed(1)}/20</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: DEFENCE_COLOR }}
              />
              <span className="truncate opacity-95">Defence</span>
            </span>
            <span className="shrink-0 font-bold tabular-nums">{defencePct}%</span>
          </li>
          <li className="flex items-center justify-between gap-2 pl-4 text-[9px] opacity-80">
            <span className="truncate">avg {defence.toFixed(1)}/20</span>
          </li>
        </ul>
      </div>
      <p
        className={
          light
            ? "mt-1.5 text-center text-[8px] leading-snug text-muted-foreground"
            : "mt-1.5 text-center text-[8px] leading-snug opacity-70"
        }
      >
        Share of total parameter score — higher slice = stronger bench favor
      </p>
    </div>
  );
}
