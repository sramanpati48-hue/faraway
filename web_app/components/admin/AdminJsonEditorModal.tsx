"use client";

import { useEffect, useState } from "react";

type Props = {
  title: string;
  column: string;
  value: unknown;
  onClose: () => void;
  onSave: (parsed: unknown) => void;
};

export function AdminJsonEditorModal({ title, column, value, onClose, onSave }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setText(JSON.stringify(value, null, 2));
      setError(null);
    } catch {
      setText(String(value));
    }
  }, [value]);

  function handleSave() {
    try {
      const parsed = JSON.parse(text) as unknown;
      onSave(parsed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  function handleFormat() {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/10 bg-[#121212] shadow-2xl">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="font-semibold text-white">{title}</h3>
          <p className="font-mono text-xs text-blue-300">{column}</p>
        </div>
        <textarea
          className="min-h-[50vh] flex-1 resize-y border-0 bg-black/50 p-4 font-mono text-xs text-white/90 outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        {error && <p className="px-4 text-xs text-red-400">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 p-3">
          <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs" onClick={handleFormat}>
            Prettify
          </button>
          <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium" onClick={handleSave}>
            Save JSON
          </button>
        </div>
      </div>
    </div>
  );
}
