"use client";

import { MapPin, Star, HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SahayakProfile } from "@/lib/sahayakTypes";
import { sahayakIdOf } from "@/lib/sahayakTypes";

interface Props {
  sahayak: SahayakProfile;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function SahayakListCard({ sahayak, selected, onClick, className }: Props) {
  const area = sahayak.location || [sahayak.city, sahayak.state].filter(Boolean).join(", ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-2xl border bg-white p-4 transition-all",
        "hover:border-[#00634B]/40 hover:shadow-md hover:shadow-[#00634B]/5",
        selected
          ? "border-[#00634B] ring-2 ring-[#00634B]/15 shadow-md"
          : "border-gray-200",
        className
      )}
      data-sahayak-id={sahayakIdOf(sahayak)}
    >
      <div className="flex gap-3">
        {sahayak.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sahayak.avatar}
            alt={sahayak.name}
            className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl object-cover border border-[#00634B]/10 flex-shrink-0"
          />
        ) : (
          <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl bg-[#E6F0ED] flex items-center justify-center text-[#00634B] font-black text-lg flex-shrink-0">
            {(sahayak.name || "G").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 truncate text-sm sm:text-[15px]">
                {sahayak.name}
              </h3>
              <p className="text-xs sm:text-sm text-[#00634B] font-semibold truncate mt-0.5">
                {sahayak.occupation || "Nyay Guide"}
              </p>
            </div>
            <div className="flex items-center gap-1 text-amber-600 text-xs font-bold flex-shrink-0">
              <Star className="w-3.5 h-3.5 fill-current" />
              {(sahayak.rating ?? 4.5).toFixed(1)}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            {area && (
              <span className="inline-flex items-center gap-1 truncate max-w-[160px]">
                <MapPin className="w-3 h-3" />
                {area}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <HeartHandshake className="w-3 h-3" />
              {sahayak.cases_resolved ?? 0} helped
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
