"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Search, type LucideIcon } from "lucide-react";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import {
  DURATION,
  EASE_OUT,
  fadeUp,
  pressable,
  pressableSubtle,
  staggerChildren,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

export { EASE_OUT, fadeUp, staggerChildren } from "@/lib/motion";

export function OperateLayout({
  children,
  className,
  wide,
}: {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        dmSans.className,
        "mx-auto w-full px-4 py-8 pb-16 sm:px-6 sm:py-10",
        wide ? "max-w-6xl" : "max-w-4xl",
        className
      )}
    >
      {children}
    </div>
  );
}

export function OperateHeader({
  kicker,
  title,
  description,
}: {
  kicker?: string;
  title: string;
  description?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.header
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.enter, ease: EASE_OUT }}
      className="mb-8"
    >
      {kicker ? (
        <p
          className={cn(
            instrumentSerif.className,
            "mb-2 text-xs uppercase tracking-[0.12em] text-[#00634B]"
          )}
        >
          {kicker}
        </p>
      ) : null}
      <h1 className={cn(instrumentSerif.className, "text-2xl text-slate-900 sm:text-3xl")}>{title}</h1>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500 sm:text-base">{description}</p>
      ) : null}
    </motion.header>
  );
}

const searchInputClass =
  "w-full rounded-lg border border-slate-200/80 bg-white py-3.5 pl-11 pr-28 text-sm text-slate-900 shadow-sm outline-none transition-[box-shadow,border-color] duration-200 ease-out placeholder:text-slate-400 focus-visible:border-emerald-200 focus-visible:ring-2 focus-visible:ring-[#00634B]/25 focus-visible:ring-offset-2 focus:shadow-md focus:shadow-emerald-900/5 sm:py-4 sm:pl-12 sm:pr-32 sm:text-base";

const searchButtonClass = cn(
  "absolute right-1.5 top-1.5 bottom-1.5 rounded-md bg-[#00634B] px-4 text-sm font-semibold text-white sm:px-5",
  pressable
);

export function OperateSearchBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  placeholder: string;
  submitLabel?: string;
}) {
  return (
    <form onSubmit={onSubmit} className="group relative mb-8">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-[#00634B] sm:left-4 sm:h-5 sm:w-5"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={searchInputClass}
      />
      <button type="submit" className={searchButtonClass}>
        {submitLabel}
      </button>
    </form>
  );
}

export function OperateTabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: LucideIcon }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="mb-6 flex w-full flex-wrap gap-1 rounded-lg border border-slate-200/80 bg-white p-1 shadow-sm sm:w-fit"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold sm:flex-none sm:px-4",
              pressableSubtle,
              selected
                ? "bg-[#00634B] text-white"
                : "text-slate-500 hover:text-[#00634B]"
            )}
          >
            {Icon ? <Icon className="h-4 w-4" /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function OperateEmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm sm:px-10 sm:py-14">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-50 text-slate-300">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className={cn(instrumentSerif.className, "text-xl text-slate-900")}>{title}</h3>
      {description ? <p className="mt-2 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

export function OperateSkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-[4.5rem] animate-pulse rounded-lg border border-slate-100 bg-white"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

export function OperateSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-lg border border-slate-100 bg-white"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

export function OperatePanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5", className)}>
      {children}
    </div>
  );
}

export function OperatePrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg bg-[#00634B] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#014D3C] disabled:cursor-not-allowed disabled:opacity-50",
        pressable,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function OperateOutlineLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200/80 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-[border-color,transform] duration-150 ease-out hover:border-emerald-200 active:scale-[0.98]",
        className
      )}
    >
      {children}
    </a>
  );
}

export function MotionListItem({
  index,
  children,
  className,
}: {
  index: number;
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      custom={index}
      variants={fadeUp}
      initial={reduce ? false : "hidden"}
      animate="visible"
      className={className}
    >
      {children}
    </motion.li>
  );
}
