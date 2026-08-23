"use client";

import { Renderer } from "@openuidev/react-lang";
import { BarChart3 } from "lucide-react";
import { policyGenUILibrary } from "@/components/admin/policy/policy-genui-library";
import { reportRenderError } from "@/components/admin/policy/policy-render-error";

export function PolicyImpactPanel({
  content,
  streaming,
  stage,
}: {
  content: string;
  streaming: boolean;
  stage: string | null;
}) {
  if (!content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <BarChart3 className="h-5 w-5 text-white/30" />
        </span>
        <p className="text-xs leading-relaxed text-white/40">
          {streaming
            ? stage || "Modelling the impact of this policy…"
            : "Run a policy draft to see who it touches — case volumes, affected users, config diffs and risks."}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <Renderer
        response={content}
        library={policyGenUILibrary}
        isStreaming={streaming}
        onError={(error) => reportRenderError("policy impact render", error, streaming)}
      />
    </div>
  );
}
