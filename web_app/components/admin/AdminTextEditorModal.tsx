"use client";

import { useEffect, useState } from "react";

type Props = {
  title: string;
  column: string;
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
};

export function AdminTextEditorModal({ title, column, value, onClose, onSave }: Props) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  function handleSave() {
    onSave(text);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/10 bg-[#121212] shadow-2xl">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="font-semibold text-white">{title}</h3>
          <p className="font-mono text-xs text-emerald-300">{column}</p>
        </div>
        <textarea
          className="min-h-[50vh] flex-1 resize-y border-0 bg-black/50 p-4 font-mono text-xs leading-relaxed text-white/90 outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 p-3">
          <span className="text-xs text-white/40">{text.length.toLocaleString()} characters</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium hover:bg-emerald-500"
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
