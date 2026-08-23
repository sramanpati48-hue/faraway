"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bold,
  Code,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pencil,
  Quote,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
};

const toolBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/60 transition hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white";

export function MarkdownEditor({ value, onChange, placeholder, minHeight = 360 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function withSelection(mutate: (args: {
    value: string;
    start: number;
    end: number;
    selected: string;
  }) => { next: string; selStart: number; selEnd: number }) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const { next, selStart, selEnd } = mutate({ value, start, end, selected });
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function wrap(before: string, after = before, placeholderText = "text") {
    withSelection(({ value: v, start, end, selected }) => {
      const inner = selected || placeholderText;
      const next = v.slice(0, start) + before + inner + after + v.slice(end);
      const selStart = start + before.length;
      return { next, selStart, selEnd: selStart + inner.length };
    });
  }

  function prefixLines(prefix: string | ((i: number) => string)) {
    withSelection(({ value: v, start, end, selected }) => {
      // Expand to full lines.
      const lineStart = v.lastIndexOf("\n", start - 1) + 1;
      const lineEndIdx = v.indexOf("\n", end);
      const lineEnd = lineEndIdx === -1 ? v.length : lineEndIdx;
      const block = v.slice(lineStart, lineEnd) || selected;
      const lines = block.split("\n");
      const transformed = lines
        .map((line, i) => {
          const p = typeof prefix === "function" ? prefix(i) : prefix;
          return line.startsWith(p) ? line : p + line;
        })
        .join("\n");
      const next = v.slice(0, lineStart) + transformed + v.slice(lineEnd);
      return { next, selStart: lineStart, selEnd: lineStart + transformed.length };
    });
  }

  function insertLink() {
    withSelection(({ value: v, start, end, selected }) => {
      const label = selected || "link text";
      const snippet = `[${label}](https://)`;
      const next = v.slice(0, start) + snippet + v.slice(end);
      // Place cursor inside the url parentheses.
      const urlStart = start + label.length + 3;
      return { next, selStart: urlStart, selEnd: urlStart + 8 };
    });
  }

  return (
    <div className="rounded-xl border border-white/[0.1] bg-black/40">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.08] px-2 py-1.5">
        <button type="button" className={toolBtn} title="Heading 1" onClick={() => prefixLines("# ")}>
          <Heading1 className="h-4 w-4" />
        </button>
        <button type="button" className={toolBtn} title="Heading 2" onClick={() => prefixLines("## ")}>
          <Heading2 className="h-4 w-4" />
        </button>
        <button type="button" className={toolBtn} title="Heading 3" onClick={() => prefixLines("### ")}>
          <Heading3 className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" className={toolBtn} title="Bold" onClick={() => wrap("**")}>
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" className={toolBtn} title="Italic" onClick={() => wrap("*")}>
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" className={toolBtn} title="Inline code" onClick={() => wrap("`", "`", "code")}>
          <Code className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" className={toolBtn} title="Bulleted list" onClick={() => prefixLines("- ")}>
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={toolBtn}
          title="Numbered list"
          onClick={() => prefixLines((i) => `${i + 1}. `)}
        >
          <ListOrdered className="h-4 w-4" />
        </button>
        <button type="button" className={toolBtn} title="Quote" onClick={() => prefixLines("> ")}>
          <Quote className="h-4 w-4" />
        </button>
        <button type="button" className={toolBtn} title="Link" onClick={insertLink}>
          <Link2 className="h-4 w-4" />
        </button>
        <div className="ml-auto">
          <button
            type="button"
            className={cn(toolBtn, "w-auto gap-1.5 px-2.5 text-xs", preview && "border-blue-500/40 bg-blue-600/20 text-white")}
            title={preview ? "Edit" : "Preview"}
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
      </div>

      {preview ? (
        <div
          className="admin-no-scrollbar overflow-y-auto px-4 py-3 text-sm leading-relaxed text-white/80"
          style={{ minHeight }}
        >
          {value.trim() ? (
            <div className="prose-admin space-y-3">
              <ReactMarkdown
                components={{
                  h1: (p) => <h1 className="text-2xl font-bold text-white" {...p} />,
                  h2: (p) => <h2 className="mt-4 text-xl font-semibold text-white" {...p} />,
                  h3: (p) => <h3 className="mt-3 text-lg font-semibold text-white/90" {...p} />,
                  p: (p) => <p className="text-white/75" {...p} />,
                  ul: (p) => <ul className="list-disc space-y-1 pl-6 text-white/75" {...p} />,
                  ol: (p) => <ol className="list-decimal space-y-1 pl-6 text-white/75" {...p} />,
                  li: (p) => <li className="text-white/75" {...p} />,
                  strong: (p) => <strong className="font-semibold text-white" {...p} />,
                  blockquote: (p) => (
                    <blockquote className="border-l-2 border-blue-500/50 pl-4 italic text-white/60" {...p} />
                  ),
                  a: (p) => <a className="text-blue-400 underline" target="_blank" rel="noreferrer" {...p} />,
                  code: (p) => <code className="rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-blue-200" {...p} />,
                }}
              >
                {value}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-white/30">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "Write the article in Markdown…"}
          spellCheck
          className="w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-white outline-none placeholder:text-white/25"
          style={{ minHeight }}
        />
      )}
    </div>
  );
}
