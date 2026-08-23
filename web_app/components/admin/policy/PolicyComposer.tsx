"use client";

import { Play, Square } from "lucide-react";
import { adminBtnPrimary, adminBtnSecondary, adminInput } from "@/components/admin/admin-ui";
import { PolicyContextPicker } from "@/components/admin/policy/PolicyContextPicker";
import type { PolicyContextRef } from "@/lib/adminApi";

export function PolicyComposer({
  title,
  description,
  attached,
  running,
  stage,
  onTitleChange,
  onDescriptionChange,
  onAttach,
  onDetach,
  onRun,
  onStop,
  onError,
}: {
  title: string;
  description: string;
  attached: PolicyContextRef[];
  running: boolean;
  stage: string | null;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onAttach: (ref: PolicyContextRef) => void;
  onDetach: (ref: PolicyContextRef) => void;
  onRun: () => void;
  onStop: () => void;
  onError: (message: string) => void;
}) {
  return (
    <section className="rounded-[20px] border border-white/[0.09] bg-[#0c0c0c] p-5">
      <h2 className="text-sm font-semibold text-white/85">Describe the policy</h2>
      <p className="mt-1 text-xs text-white/40">
        Write it the way you would explain it to a colleague. The studio finds the affected tables and
        features, asks what it still needs, and shows the impact before anything changes.
      </p>

      <input
        className={`${adminInput} mt-4 text-sm`}
        placeholder="Policy name (optional)"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
      />

      <textarea
        className={`${adminInput} mt-3 min-h-[130px] resize-y text-sm leading-relaxed`}
        placeholder="e.g. Any domestic-violence case from a rural district should skip the local forum suggestion and go straight to a female lawyer, and moderators must review it within 45 minutes."
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
      />

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
          Attach context
        </h3>
        <PolicyContextPicker
          attached={attached}
          onAttach={onAttach}
          onDetach={onDetach}
          onError={onError}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${adminBtnPrimary} gap-2 text-sm`}
          onClick={onRun}
          disabled={running || !description.trim()}
        >
          <Play className="h-3.5 w-3.5" />
          {running ? "Working…" : "Run policy studio"}
        </button>
        {running ? (
          <button type="button" className={`${adminBtnSecondary} gap-2 text-sm`} onClick={onStop}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : null}
        {stage ? <span className="text-xs text-white/45">{stage}</span> : null}
      </div>
    </section>
  );
}
