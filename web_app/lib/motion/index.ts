/**
 * NyaySahayak motion tokens — Emil Kowalski / Apple fluid-interface aligned.
 * Use Framer Motion for occasional page enters & staggered lists.
 * Use CSS classes for press feedback (high-frequency, GPU-friendly).
 */

/** Strong ease-out — entering UI, press release */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** On-screen movement between two settled states */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

export const DURATION = {
  press: 0.15,
  hover: 0.2,
  enter: 0.35,
  tab: 0.2,
  /** Sidebar rail width / main pad — keep in sync with layout + HomeSidebar */
  sidebar: 0.32,
  /** Label fade before/after rail width change */
  sidebarLabel: 0.16,
} as const;

/**
 * Sidebar collapse — strong ease-out, compositor-friendly props only.
 * Pair with phased label hide (see AppShell layout) so icons don't reflow mid-width.
 */
export const sidebarRailMotion =
  "transition-[width,transform] duration-[320ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none";

export const sidebarPadMotion =
  "transition-[padding] duration-[320ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none";

/** Nav / brand labels — clip + fade; never unmount mid-collapse */
export const sidebarLabelMotion =
  "overflow-hidden whitespace-nowrap transition-[opacity,max-width,transform] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none";

/** Position-only layout morph for sidebar quick-action row (no size squash). */
export const sidebarLayoutTransition = {
  layout: {
    type: "tween" as const,
    duration: DURATION.sidebar,
    ease: EASE_IN_OUT,
  },
};

/** CSS fallback for gap/stack reflow on the action row container */
export const sidebarActionRowMotion =
  "transition-[gap] duration-[320ms] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none";

export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.enter, delay: i * 0.05, ease: EASE_OUT },
  }),
};

/** Reduced-motion safe: opacity-only enter */
export const fadeIn = {
  hidden: { opacity: 0 },
  visible: (i: number = 0) => ({
    opacity: 1,
    transition: { duration: DURATION.enter, delay: i * 0.04, ease: EASE_OUT },
  }),
};

export const staggerChildren = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

/** Primary buttons & CTAs — feedback on press, not hover scale */
export const pressable =
  "cursor-pointer transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out active:scale-[0.97]";

/** Cards & list rows — subtle press on tap */
export const pressableCard =
  "cursor-pointer transition-[transform,border-color,box-shadow] duration-200 ease-out active:scale-[0.99]";

/** Nav & icon buttons used often — lighter scale */
export const pressableSubtle =
  "cursor-pointer transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.98]";

/** Hover elevation — pointer devices only (see globals.css .motion-hover-card) */
export const hoverCard = "motion-hover-card";

/** Panel show/hide — GPU-friendly; do not use transition-all on split layouts */
export const panelMotion =
  "transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none";

/** 44×44px minimum hit area on mobile (< md). Apple HIG / WCAG 2.5.5. */
export const touchIconButton =
  "inline-flex shrink-0 items-center justify-center h-11 w-11 md:h-10 md:w-10";

/** Icon control that stays compact on desktop (sidebar row actions). */
export const touchIconButtonCompact =
  "inline-flex shrink-0 items-center justify-center h-11 w-11 md:h-8 md:w-8";

/** Nav / list row — taller tap row on mobile only. */
export const touchNavRow = "max-md:min-h-11 max-md:items-center";

/** Keyboard focus — match auth fields and primary brand ring. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00634B]/30 focus-visible:ring-offset-2";

/** Do NOT animate: sidebar nav clicks, chat messages after first paint, keyboard shortcuts, search typing */
