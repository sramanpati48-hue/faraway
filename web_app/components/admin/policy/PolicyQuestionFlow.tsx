"use client";

import { useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { adminBtnPrimary, adminInput } from "@/components/admin/admin-ui";
import {
  PolicyGenUIProvider,
  policyGenUILibrary,
} from "@/components/admin/policy/policy-genui-library";
import { reportRenderError } from "@/components/admin/policy/policy-render-error";

export function PolicyQuestionFlow({
  content,
  fallbackQuestions,
  streaming,
  busy,
  onSubmitAnswers,
}: {
  content: string;
  fallbackQuestions?: string[];
  streaming: boolean;
  busy: boolean;
  onSubmitAnswers: (answers: Record<string, string>) => void;
}) {
  if (!content) {
    return <PlainQuestions questions={fallbackQuestions || []} busy={busy} onSubmit={onSubmitAnswers} />;
  }
  return (
    <PolicyGenUIProvider onSubmitAnswers={onSubmitAnswers} busy={busy}>
      <Renderer
        response={content}
        library={policyGenUILibrary}
        isStreaming={streaming}
        onError={(error) => reportRenderError("policy questions render", error, streaming)}
      />
    </PolicyGenUIProvider>
  );
}

/**
 * The generated form is the normal path. This keeps the draft moving when the
 * model returns nothing renderable, since the change set stays blocked until
 * the open questions are answered.
 */
function PlainQuestions({
  questions,
  busy,
  onSubmit,
}: {
  questions: string[];
  busy: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (!questions.length) return null;

  return (
    <form
      className="rounded-[20px] border border-white/[0.09] bg-[#0c0c0c] p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        onSubmit(Object.fromEntries(questions.map((q) => [q, values[q] ?? ""])));
      }}
    >
      <h2 className="text-sm font-semibold text-white/85">A few details before this is ready</h2>
      <p className="mt-1 text-xs text-white/45">
        Answer what you can — anything left blank stays an open question.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {questions.map((question, i) => (
          <div key={i}>
            <label htmlFor={`pqf-${i}`} className="mb-1.5 block text-xs font-medium text-white/70">
              {question}
            </label>
            <textarea
              id={`pqf-${i}`}
              rows={2}
              className={`${adminInput} resize-y`}
              value={values[question] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [question]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <button type="submit" className={`${adminBtnPrimary} mt-4 text-xs`} disabled={busy}>
        {busy ? "Refining…" : "Submit answers"}
      </button>
    </form>
  );
}
