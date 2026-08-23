import Link from "next/link";
import { dmSans, instrumentSerif } from "@/lib/fonts";
import { cn } from "@/lib/utils";

export function MarketingLegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(dmSans.className, "min-h-screen bg-white text-slate-900")}>
      <header className="border-b border-slate-200/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="text-sm font-semibold text-slate-900">
            Nyay<span className="text-[#00634B]">Sahayak</span>
          </Link>
          <Link href="/" className="text-sm font-medium text-slate-600 hover:text-[#00634B]">
            Back to home
          </Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className={cn(instrumentSerif.className, "text-3xl text-slate-900 sm:text-4xl")}>{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>
        <div className="prose-legal mt-10 space-y-8 text-sm leading-relaxed text-slate-700">{children}</div>
      </article>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
