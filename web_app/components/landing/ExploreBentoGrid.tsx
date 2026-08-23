"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EXPLORE_TOOLS } from "@/components/landing/landing-data";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { focusRing } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ExploreBentoItem = (typeof EXPLORE_TOOLS)[number];

function ExploreBentoCard({ item }: { item: ExploreBentoItem }) {
  const isLarge = item.bentoSize === "large";

  return (
    <Link
      href={item.href}
      className={cn(
        dmSans.className,
        "group relative z-0 flex h-full min-w-0 origin-center scale-100 transform-gpu flex-col overflow-hidden rounded-[1.75rem]",
        "border border-slate-200/75 bg-[#FAFAF9]",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_32px_-16px_rgba(15,23,42,0.10)]",
        "cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:z-10 hover:scale-[1.02] hover:border-emerald-200/90 hover:shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_-18px_rgba(0,99,75,0.14)]",
        "active:scale-[0.995]",
        "motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
        focusRing
      )}
    >
      <div className="flex flex-col px-6 pb-0 pt-6 sm:px-7 sm:pt-7 md:px-8 md:pt-8">
        <h3
          className={cn(
            instrumentSerif.className,
            "mt-0 text-pretty text-xl leading-snug text-slate-900 sm:text-[1.35rem]",
            isLarge && "sm:text-2xl"
          )}
        >
          {item.title}
        </h3>
        <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-slate-500">{item.desc}</p>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#00634B] opacity-0 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100">
          Open tool
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>

      <div
        className={cn(
          "relative mt-5 flex-1",
          isLarge ? "min-h-[13.5rem] sm:min-h-[15rem] md:min-h-[17.5rem]" : "min-h-[11.5rem] sm:min-h-[12.5rem] md:min-h-[14rem]"
        )}
      >
        <div
          className={cn(
            "absolute inset-x-5 bottom-0 top-0 overflow-hidden rounded-t-[1.25rem]",
            "border border-b-0 border-slate-200/70 bg-white",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
            "md:inset-x-6"
          )}
        >
          <Image
            src={item.image}
            alt={item.imageAlt}
            fill
            className="object-cover object-top"
            sizes={
              isLarge
                ? "(max-width: 768px) 100vw, (max-width: 1280px) 60vw, 720px"
                : "(max-width: 768px) 100vw, (max-width: 1280px) 40vw, 480px"
            }
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#FAFAF9] via-[#FAFAF9]/80 to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white/50 to-transparent"
            aria-hidden
          />
        </div>
      </div>
    </Link>
  );
}

export function ExploreBentoGrid({ items }: { items: ExploreBentoItem[] }) {
  const rowOne = items.slice(0, 2);
  const rowTwo = items.slice(2, 4);

  return (
    <div className="mt-12 flex flex-col gap-4 sm:gap-5">
      <ul className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-stretch">
        {rowOne.map((item) => (
          <li key={item.href} className="min-w-0">
            <ExploreBentoCard item={item} />
          </li>
        ))}
      </ul>
      <ul className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-stretch">
        {rowTwo.map((item) => (
          <li key={item.href} className="min-w-0">
            <ExploreBentoCard item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}
