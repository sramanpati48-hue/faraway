import { dmSans } from "@/lib/fonts";
import { focusRing } from "@/lib/motion";

/** Shared focus-visible styles for auth form controls (WCAG 2.4.7). */
export const authFieldClass =
  `${dmSans.className} w-full rounded-xl border border-slate-200/80 bg-white py-3 text-base text-slate-900 outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-emerald-600 ${focusRing}`;

export const authFieldWithIconClass = `${authFieldClass} pl-10 pr-3`;

export const authFieldPlainClass = `${authFieldClass} px-3`;

export const authSelectClass = `${authFieldPlainClass} bg-white`;

export const authSubmitClass =
  `${dmSans.className} w-full rounded-xl bg-[#00634B] py-3 text-base font-semibold text-white flex items-center justify-center gap-2 hover:bg-[#014D3C] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00634B]/40 focus-visible:ring-offset-2`;

export const authLinkButtonClass = `${dmSans.className} text-emerald-700 font-semibold rounded-md ${focusRing}`;
