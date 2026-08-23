"use client";

import { useRef } from "react";
import Image from "next/image";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { dmSans, instrumentSerif } from "@/lib/fonts";

export type ScrollShowcaseItem = {
  image: string;
  title: string;
  description: string;
  imageAlt?: string;
};

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Gentle ease-in-out — scroll focus & combined transitions */
function easeInOutQuart(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Map linear scroll progress to a stepped focus index with dwell plateaus,
 * so each card stays fully visible before the next transition begins.
 */
function focusFromProgress(p: number, count: number): number {
  if (count <= 1) return 0;

  const segments = count - 1;
  const travel = p * segments;
  const seg = Math.min(segments - 1, Math.floor(travel));
  const segT = travel - seg;

  const hold = 0.26;
  const trans = 0.48;

  if (segT <= hold) return seg;
  if (segT >= 1 - hold) return seg + 1;

  const transT = (segT - hold) / trans;
  return seg + easeInOutQuart(transT);
}

type CardVisual = {
  y: number;
  scale: number;
  opacity: number;
  zIndex: number;
};

function cardVisual(index: number, count: number, focus: number): CardVisual {
  const ENTER_Y = 76;
  const EXIT_Y = -64;

  if (count <= 1) {
    return { y: 0, scale: 1, opacity: 1, zIndex: 20 };
  }

  const hiddenBelow: CardVisual = { y: ENTER_Y, scale: 0.97, opacity: 0, zIndex: 0 };
  const hiddenAbove: CardVisual = { y: EXIT_Y, scale: 0.97, opacity: 0, zIndex: 0 };
  const active: CardVisual = { y: 0, scale: 1, opacity: 1, zIndex: 30 };

  if (Math.abs(focus - index) < 0.015) {
    return active;
  }

  if (focus < index - 0.02) {
    return hiddenBelow;
  }

  if (focus > index + 0.98) {
    return hiddenAbove;
  }

  // Exiting: focus drifts from index → index+1
  if (focus > index && index < count - 1) {
    const t = focus - index;
    const drift = easeInOutQuart(t);
    const fade = smoothstep(0, 0.96, t);
    return {
      y: EXIT_Y * drift,
      scale: 1 - drift * 0.028,
      opacity: 1 - fade,
      zIndex: 28 - Math.round(drift * 8),
    };
  }

  // Entering: focus drifts from index-1 → index
  if (focus > index - 1 && focus < index && index > 0) {
    const t = focus - (index - 1);
    const rise = easeInOutQuart(t);
    const fade = smoothstep(0.04, 0.98, t);
    return {
      y: ENTER_Y * (1 - rise),
      scale: 0.972 + rise * 0.028,
      opacity: fade,
      zIndex: 12 + Math.round(rise * 18),
    };
  }

  return focus >= index ? hiddenAbove : hiddenBelow;
}

function cardTransforms(index: number, count: number, progress: MotionValue<number>) {
  const focus = useTransform(progress, (p) => focusFromProgress(p, count));
  const y = useTransform(focus, (f) => cardVisual(index, count, f).y);
  const scale = useTransform(focus, (f) => cardVisual(index, count, f).scale);
  const opacity = useTransform(focus, (f) => cardVisual(index, count, f).opacity);
  const zIndex = useTransform(focus, (f) => cardVisual(index, count, f).zIndex);

  return { y, scale, opacity, zIndex };
}

const showcaseImageFrameClass = cn(
  "overflow-hidden rounded-2xl bg-white p-1.5 sm:p-2",
  "border-2 border-slate-200/85 ring-[3px] ring-slate-100/90",
  "shadow-[0_24px_56px_-22px_rgba(15,23,42,0.2),0_10px_28px_-12px_rgba(15,23,42,0.1)]"
);

const showcaseImageInnerClass = "overflow-hidden rounded-xl border border-slate-200/70 bg-slate-50";

function ShowcaseCard({
  index,
  count,
  progress,
  item,
}: {
  index: number;
  count: number;
  progress: MotionValue<number>;
  item: ScrollShowcaseItem;
}) {
  const { y, scale, opacity, zIndex } = cardTransforms(index, count, progress);

  return (
    <motion.div
      className="absolute inset-x-0 top-1/2 mx-auto w-full max-w-[min(100%,56rem)] -translate-y-1/2 will-change-transform"
      style={{ y, scale, opacity, zIndex }}
    >
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-slate-200/90 bg-white",
          "shadow-[0_28px_56px_-20px_rgba(15,23,42,0.14),0_12px_28px_-12px_rgba(15,23,42,0.08)]"
        )}
      >
        <div className="relative aspect-[16/10] w-full bg-slate-50 sm:aspect-[16/9]">
          <Image
            src={item.image}
            alt={item.imageAlt ?? item.title}
            fill
            className="object-cover object-top"
            sizes="(max-width: 768px) 100vw, 896px"
            priority={index === 0}
          />
        </div>
      </div>
    </motion.div>
  );
}

const STEP_INACTIVE_OPACITY = 0.38;
const STEP_ACTIVE_OPACITY = 1;

/** 1 when step matches scroll focus; floors at STEP_INACTIVE_OPACITY for other steps */
function stepItemOpacity(index: number, count: number, focus: number): number {
  if (count <= 1) return STEP_ACTIVE_OPACITY;
  const dist = Math.abs(focus - index);
  const activeWeight = smoothstep(0.44, 0.06, dist);
  return STEP_INACTIVE_OPACITY + activeWeight * (STEP_ACTIVE_OPACITY - STEP_INACTIVE_OPACITY);
}

/** 0→1 fill for the connector between step `segmentIndex` and the next step */
function stepSegmentFill(focus: number, segmentIndex: number): number {
  if (focus <= segmentIndex) return 0;
  if (focus >= segmentIndex + 1) return 1;
  return easeInOutQuart(focus - segmentIndex);
}

function StepRail({
  items,
  progress,
  className,
}: {
  items: ScrollShowcaseItem[];
  progress: MotionValue<number>;
  className?: string;
}) {
  const count = items.length;

  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item, index) => (
        <StepRailItem
          key={item.title}
          index={index}
          count={count}
          progress={progress}
          title={item.title}
          description={item.description}
          showConnector={index < count - 1}
        />
      ))}
    </ol>
  );
}

function StepBadge({
  index,
  count,
  progress,
}: {
  index: number;
  count: number;
  progress: MotionValue<number>;
}) {
  const itemOpacity = useTransform(progress, (p) =>
    stepItemOpacity(index, count, focusFromProgress(p, count))
  );
  const dotScale = useTransform(itemOpacity, (o) => 0.94 + o * 0.06);

  return (
    <motion.span
      style={{ scale: dotScale, opacity: itemOpacity }}
      className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#00634B] bg-[#00634B] text-xs font-bold text-white"
      aria-hidden
    >
      {index + 1}
    </motion.span>
  );
}

function StepConnector({
  segmentIndex,
  count,
  progress,
}: {
  segmentIndex: number;
  count: number;
  progress: MotionValue<number>;
}) {
  const fill = useTransform(progress, (p) => {
    const focus = focusFromProgress(p, count);
    return stepSegmentFill(focus, segmentIndex);
  });

  const fillHeight = useTransform(fill, (f) => `${f * 100}%`);

  const trackOpacity = useTransform(progress, (p) => {
    const focus = focusFromProgress(p, count);
    if (focus >= segmentIndex + 1) return 0.55;
    if (focus > segmentIndex) return 0.75;
    return 0.45;
  });

  return (
    <motion.div
      className="relative mt-3 w-[3px] min-h-[1.75rem] flex-1 overflow-hidden rounded-full bg-slate-200/90"
      style={{ opacity: trackOpacity }}
      aria-hidden
    >
      <motion.div
        className="absolute inset-x-0 top-0 rounded-full bg-[#00634B]"
        style={{ height: fillHeight }}
      />
    </motion.div>
  );
}

function StepRailItem({
  index,
  count,
  progress,
  title,
  description,
  showConnector,
}: {
  index: number;
  count: number;
  progress: MotionValue<number>;
  title: string;
  description: string;
  showConnector: boolean;
}) {
  const itemOpacity = useTransform(progress, (p) =>
    stepItemOpacity(index, count, focusFromProgress(p, count))
  );

  return (
    <li className="flex gap-3 sm:gap-4">
      <div className="flex w-8 shrink-0 flex-col items-center self-stretch">
        <StepBadge index={index} count={count} progress={progress} />
        {showConnector ? (
          <StepConnector segmentIndex={index} count={count} progress={progress} />
        ) : null}
      </div>
      <motion.div
        style={{ opacity: itemOpacity }}
        className={cn("min-w-0 flex-1", showConnector && "pb-6 lg:pb-8")}
      >
        <p className="text-base font-semibold text-slate-900 sm:text-lg">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
      </motion.div>
    </li>
  );
}

function MobileActiveCaption({
  items,
  progress,
}: {
  items: ScrollShowcaseItem[];
  progress: MotionValue<number>;
}) {
  const count = items.length;

  return (
    <div className="relative mb-4 min-h-[4.5rem] lg:hidden">
      {items.map((item, index) => (
        <MobileCaptionLine key={item.title} index={index} count={count} progress={progress} item={item} />
      ))}
    </div>
  );
}

function MobileCaptionLine({
  index,
  count,
  progress,
  item,
}: {
  index: number;
  count: number;
  progress: MotionValue<number>;
  item: ScrollShowcaseItem;
}) {
  const opacity = useTransform(progress, (p) => {
    const focus = focusFromProgress(p, count);
    const activeWeight = smoothstep(0.44, 0.06, Math.abs(focus - index));
    return activeWeight;
  });

  const y = useTransform(progress, (p) => {
    const focus = focusFromProgress(p, count);
    return (index - focus) * 6;
  });

  return (
    <motion.div className="absolute inset-x-0 top-0" style={{ opacity, y }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#00634B]/70">
        Step {index + 1} of {count}
      </p>
      <p className={cn(instrumentSerif.className, "mt-1 text-lg text-slate-900")}>{item.title}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{item.description}</p>
    </motion.div>
  );
}

function ReducedMotionShowcase({ items }: { items: ScrollShowcaseItem[] }) {
  return (
    <div className={cn(dmSans.className, "mt-6 space-y-10")}>
      {items.map((item, index) => (
        <article key={item.title} className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_1fr] lg:items-center">
          <div>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#00634B] text-xs font-bold text-white">
              {index + 1}
            </span>
            <h3 className={cn(instrumentSerif.className, "mt-3 text-xl text-slate-900")}>{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{item.description}</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-lg">
            <div className="relative aspect-[16/10] w-full bg-slate-50">
              <Image
                src={item.image}
                alt={item.imageAlt ?? item.title}
                fill
                className="object-cover object-top"
                sizes="(max-width: 1024px) 100vw, 720px"
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ScrollShowcase({ items }: { items: ScrollShowcaseItem[] }) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const count = items.length;
  const scrollSegments = Math.max(count - 1, 1);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 85,
    damping: 26,
    mass: 0.45,
    restDelta: 0.0008,
  });

  if (reduceMotion || count === 0) {
    return <ReducedMotionShowcase items={items} />;
  }

  return (
    <div
      ref={containerRef}
      className={cn(dmSans.className, "relative mt-6 md:mt-8")}
      style={{ height: `calc(${scrollSegments * 140 + 115}vh)` }}
    >
      <div className="sticky top-0 flex h-[min(100dvh,920px)] min-h-[28rem] flex-col justify-center py-6 md:min-h-[32rem] md:py-10">
        <MobileActiveCaption items={items} progress={smoothProgress} />

        <div className="grid flex-1 items-center gap-6 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-14 xl:grid-cols-[minmax(0,22rem)_1fr]">
          <div className="hidden lg:block">
            <StepRail items={items} progress={smoothProgress} />
          </div>

          <div className="relative mx-auto h-[min(46vh,18rem)] w-full overflow-hidden sm:h-[min(52vh,22rem)] lg:h-[min(68vh,34rem)] lg:max-w-none">
            {items.map((item, index) => (
              <ShowcaseCard
                key={item.title}
                index={index}
                count={count}
                progress={smoothProgress}
                item={item}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
