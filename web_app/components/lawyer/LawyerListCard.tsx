"use client";

import { MapPin, Star, Briefcase, Shield } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { pressable, pressableCard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { LawyerProfile } from "@/lib/lawyerTypes";
import { lawyerIdOf } from "@/lib/lawyerTypes";

interface Props {
  lawyer: LawyerProfile;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function LawyerListCard({ lawyer, selected, onClick, className }: Props) {
  const areas = lawyer.practice_areas?.length
    ? lawyer.practice_areas
    : lawyer.specialization
      ? [lawyer.specialization]
      : [];
  const rate = lawyer.hourly_rate != null && lawyer.hourly_rate !== ""
    ? `₹${lawyer.hourly_rate}/hr`
    : "On request";
  const years = lawyer.experience != null && lawyer.experience !== ""
    ? `${lawyer.experience} yrs`
    : "—";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border bg-white p-4 text-left shadow-sm motion-hover-card",
        pressableCard,
        selected
          ? "border-[#00634B] ring-2 ring-[#00634B]/15 shadow-md"
          : "border-slate-200/80",
        className
      )}
      data-lawyer-id={lawyerIdOf(lawyer)}
    >
      <div className="flex gap-3">
        {lawyer.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lawyer.avatar}
            alt={lawyer.name}
            className="h-12 w-12 shrink-0 rounded-lg border border-emerald-100 object-cover sm:h-14 sm:w-14"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-lg font-bold text-[#00634B] sm:h-14 sm:w-14">
            {(lawyer.name || "A").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className={cn(instrumentSerif.className, "truncate text-base text-slate-900")}>
                  {lawyer.name}
                </h3>
                {lawyer.verified && (
                  <Shield className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                )}
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold text-[#00634B] sm:text-sm">
                {lawyer.headline || areas[0] || "Legal professional"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-700">
              <Star className="h-3.5 w-3.5 fill-current" />
              {(lawyer.rating ?? 4.5).toFixed(1)}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {lawyer.location && (
              <span className="inline-flex max-w-[140px] items-center gap-1 truncate">
                <MapPin className="h-3 w-3" />
                {lawyer.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              {years}
            </span>
            <span className="font-semibold text-slate-700">{rate}</span>
          </div>
          {areas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {areas.slice(0, 2).map((a) => (
                <span
                  key={a}
                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900"
                >
                  {a}
                </span>
              ))}
              {areas.length > 2 && (
                <span className="text-[10px] font-medium text-slate-500">+{areas.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
