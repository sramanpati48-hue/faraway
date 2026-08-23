"use client";

import { Suspense } from "react";
import { ScamHeatmap } from "@/components/dashboard/ScamHeatmap";
import { OperateLayout } from "@/components/operate/OperatePrimitives";

export default function ScamHeatmapPage() {
  return (
    <OperateLayout wide>
      <Suspense
        fallback={
          <div className="rounded-xl border border-slate-200/80 bg-white p-10 text-center text-sm text-slate-500">
            Loading scam heatmap…
          </div>
        }
      >
        <ScamHeatmap />
      </Suspense>
    </OperateLayout>
  );
}
