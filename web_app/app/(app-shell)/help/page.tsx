"use client";

import Link from "next/link";
import { ExternalLink, HelpCircle, Phone } from "lucide-react";
import { FAQ_ITEMS } from "@/components/landing/landing-data";
import {
  OperateHeader,
  OperateLayout,
  OperatePanel,
} from "@/components/operate/OperatePrimitives";
import { LEGAL_LIBRARY_LINKS, URGENT_HELPLINES } from "@/lib/home/mockData";
import { pressableSubtle, focusRing } from "@/lib/motion";
import { cn } from "@/lib/utils";

export default function HelpPage() {
  return (
    <OperateLayout>
      <OperateHeader
        kicker="Support"
        title="Help & guidance"
        description="Urgent numbers, common questions, and links to tools inside NyaySahayak. For our mission and story, see the public about page."
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Emergency & helplines</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {URGENT_HELPLINES.map((h) => (
            <OperatePanel key={h.number} className="p-4">
              <p className="text-sm font-medium text-slate-800">{h.label}</p>
              <a
                href={`tel:${h.number.replace(/\D/g, "")}`}
                className={cn(pressableSubtle, focusRing, "mt-2 inline-flex items-center gap-2 rounded-md px-1 text-lg font-semibold text-[#00634B]")}
              >
                <Phone className="h-4 w-4" aria-hidden />
                {h.number}
              </a>
              <p className="mt-1 text-xs text-slate-500">{h.note}</p>
            </OperatePanel>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">In the app</h2>
        <ul className="space-y-2">
          {LEGAL_LIBRARY_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  pressableSubtle,
                  focusRing,
                  "block rounded-lg border border-slate-200/80 bg-white px-4 py-3 shadow-sm transition-[border-color,box-shadow] hover:border-emerald-200/80"
                )}
              >
                <span className="text-sm font-semibold text-slate-900">{link.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{link.desc}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Common questions</h2>
        <div className="rounded-xl border border-slate-200/80 bg-white divide-y divide-slate-100">
          {FAQ_ITEMS.slice(0, 4).map((item) => (
            <details key={item.q} className="group px-4 py-3">
              <summary className={cn(focusRing, "cursor-pointer list-none rounded-md px-1 text-sm font-semibold text-slate-900 marker:content-none [&::-webkit-details-marker]:hidden")}>
                {item.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <OperatePanel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#00634B]" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-slate-900">About NyaySahayak</p>
            <p className="mt-1 text-sm text-slate-500">Mission, values, and how we approach legal guidance.</p>
          </div>
        </div>
        <Link
          href="/about"
          className={cn(
            pressableSubtle,
            focusRing,
            "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#00634B] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#014D3C]"
          )}
        >
          Read about us
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </OperatePanel>
    </OperateLayout>
  );
}
