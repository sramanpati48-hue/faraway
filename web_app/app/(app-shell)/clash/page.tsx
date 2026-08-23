"use client";

import { Suspense } from "react";
import { ClashPageShell } from "@/components/clash/ClashPageShell";
import { Loader2 } from "lucide-react";

function ClashFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Loader2 className="size-8 animate-spin text-primary" aria-label="Loading" />
    </div>
  );
}

export default function ClashPage() {
  return (
    <Suspense fallback={<ClashFallback />}>
      <ClashPageShell />
    </Suspense>
  );
}
