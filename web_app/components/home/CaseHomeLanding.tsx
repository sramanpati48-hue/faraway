"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ChevronDown,
  Loader2,
  Mic,
  Paperclip,
  Scale,
  Send,
  Sparkles,
  Users,
  Clock,
  Shield,
} from "lucide-react";
import {
  FALLBACK_FILING_TEMPLATES,
  MOCK_TRACKING_CASES,
  type FilingTemplateOption,
  type TrackingCase,
} from "@/lib/home/mockData";
import { cn } from "@/lib/utils";
import { instrumentSerif, dmSans } from "@/lib/fonts";
import { pressable, pressableSubtle, pressableCard, hoverCard, fadeUp, EASE_OUT, DURATION, touchIconButtonCompact, touchNavRow } from "@/lib/motion";
import { ComposerBackgroundLayer } from "@/components/home/ComposerBackgroundLayer";
import {
  ComposerBackgroundPicker,
  useComposerBackgroundChoice,
} from "@/components/home/ComposerBackgroundPicker";
import { composerBackgroundUsesLightText, borderSpinGradientStyle, resolveBorderSpinColor } from "@/lib/home/composerBackground";
import { COMPOSER_FILE_ACCEPT, filesToChatAttachments, type ChatAttachmentPayload } from "@/lib/chatAttachments";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const CUSTOM_GUIDE_ID = "custom";

const statusToneClass: Record<TrackingCase["statusTone"], string> = {
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
};

type CaseHomeLandingProps = {
  onStartChat: (message: string, opts?: { voice?: boolean; attachments?: ChatAttachmentPayload[] }) => void;
  disabled?: boolean;
};

export function CaseHomeLanding({ onStartChat, disabled }: CaseHomeLandingProps) {
  const reduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<FilingTemplateOption[]>(FALLBACK_FILING_TEMPLATES);
  const [selectedGuideId, setSelectedGuideId] = useState<string>(CUSTOM_GUIDE_ID);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [backgroundSettings, setBackgroundSettings] = useComposerBackgroundChoice();
  const latestCase = MOCK_TRACKING_CASES[0];
  const usesLightText = composerBackgroundUsesLightText(backgroundSettings);

  const selectedTemplate =
    selectedGuideId === CUSTOM_GUIDE_ID
      ? null
      : templates.find((t) => t.id === selectedGuideId) ?? null;
  const isGuidedMode = selectedGuideId !== CUSTOM_GUIDE_ID && !!selectedTemplate;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/file-case/templates`);
        if (res.ok) {
          const data = await res.json();
          const rows = (data.templates || []).map((t: { id: string; title: string; category: string; action_prompt?: string }) => ({
            id: t.id,
            title: t.title,
            category: t.category,
            action_prompt: t.action_prompt || `Help me with: ${t.title}`,
          }));
          if (!cancelled && rows.length) {
            setTemplates(rows);
          }
        }
      } catch {
        /* keep fallback */
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const prefix = isGuidedMode ? selectedTemplate?.action_prompt?.trim() || "" : "";
  const composedMessage = useMemo(() => {
    const body = input.trim();
    if (!prefix) return body;
    if (!body) return prefix;
    return `${prefix}\n\n${body}`;
  }, [prefix, input]);

  const submit = useCallback(
    async (opts?: { voice?: boolean }) => {
      const message = composedMessage.trim();
      if (opts?.voice) {
        const payloads = attachments.length ? await filesToChatAttachments(attachments) : undefined;
        onStartChat(message, { voice: true, attachments: payloads });
        return;
      }
      if (!message && attachments.length === 0) return;
      const payloads = await filesToChatAttachments(attachments);
      onStartChat(message || `Please review the attached file${payloads.length > 1 ? "s" : ""}: ${payloads.map((p) => p.name).join(", ")}`, {
        attachments: payloads,
      });
    },
    [composedMessage, attachments, onStartChat]
  );

  const onFiles = (list: FileList | File[] | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setAttachments((prev) => [...prev, ...files]);
  };

  return (
    <div
      className={cn(
        dmSans.className,
        "relative mx-auto flex w-full max-w-5xl flex-col rounded-2xl px-6 py-8 sm:px-10 sm:py-10 md:px-12 md:py-12"
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <ComposerBackgroundLayer
          settings={backgroundSettings}
          overlayOpacity={backgroundSettings.overlayOpacity}
          noiseOpacity={backgroundSettings.noiseOpacity}
          className="rounded-2xl"
        />
      </div>
      <ComposerBackgroundPicker
        value={backgroundSettings}
        onChange={setBackgroundSettings}
        disabled={disabled}
        className="right-3 top-3"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.enter, ease: EASE_OUT }}
        className="mb-6 text-center"
      >
        <h1
          className={cn(
            instrumentSerif.className,
            "text-4xl font-normal tracking-normal sm:text-5xl",
            usesLightText ? "text-white" : "text-slate-900"
          )}
        >
          You deserve to be heard
        </h1>
        <p
          className={cn(
            "mx-auto mt-2 max-w-lg text-base leading-relaxed text-pretty",
            usesLightText ? "text-white/85" : "text-slate-500"
          )}
        >
          Share your situation in your own words. We&apos;ll help you understand your rights, explain your
          legal options, and guide you toward the next step.
        </p>
      </motion.div>

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : 0.1, duration: DURATION.enter, ease: EASE_OUT }}
        className="relative rounded-lg p-[7px] shadow-xl shadow-emerald-900/10"
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden rounded-lg",
            reduceMotion && "hidden"
          )}
        >
          <div
            className="absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_4s_linear_infinite] scale-[1.4]"
            style={borderSpinGradientStyle(resolveBorderSpinColor(backgroundSettings.borderSpinColor1))}
          />
          <div
            className="absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_4s_linear_infinite] scale-[1.4] [animation-delay:1.4s]"
            style={borderSpinGradientStyle(resolveBorderSpinColor(backgroundSettings.borderSpinColor2))}
          />
        </div>
        <div className="relative z-10 overflow-visible rounded-[calc(0.5rem-7px)] bg-white p-3 ring-1 ring-slate-100/80">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isGuidedMode
              ? "Add details — dates, people involved, amounts…"
              : "Describe your legal issue in your own words…"
          }
          rows={3}
          disabled={disabled}
          className="composer-scroll w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (disabled || (!composedMessage.trim() && attachments.length === 0)) return;
            void submit();
          }}
        />

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 px-2">
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
              >
                <Paperclip className="h-3 w-3" />
                {a.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2  border-slate-100 pt-2">
          <input
            id="cases-landing-files"
            ref={fileRef}
            type="file"
            multiple
            accept={COMPOSER_FILE_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <label
            htmlFor="cases-landing-files"
            className={cn(
              pressableSubtle,
              touchNavRow,
              "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-600 hover:border-emerald-200 hover:bg-slate-100 hover:text-[#00634B] md:py-2",
              disabled && "pointer-events-none opacity-40"
            )}
          >
            <Paperclip className="h-4 w-4" />
            Attach
            {attachments.length > 0 ? ` (${attachments.length})` : ""}
          </label>

          <div className="relative">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setTemplateOpen((v) => !v)}
              aria-pressed={isGuidedMode}
              className={cn(
                pressableSubtle,
                touchNavRow,
                "inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border px-3 py-2.5 md:py-2 text-xs font-medium sm:max-w-none disabled:opacity-40",
                isGuidedMode
                  ? "border-[#00634B] bg-emerald-50/80 text-[#00634B] shadow-[0_0_0_2px_rgba(0,99,75,0.15)]"
                  : "border-slate-200 text-slate-700 hover:border-emerald-200 hover:bg-slate-100 hover:text-[#00634B]"
              )}
            >
              <Sparkles className={cn("h-4 w-4", isGuidedMode ? "text-[#00634B]" : "text-slate-400")} />
              <span className="truncate">
                {isGuidedMode ? selectedTemplate?.title : "Custom"}
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 ease-out", templateOpen && "rotate-180")} />
            </button>
            {templateOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl motion-enter-fade">
                {loadingTemplates && (
                  <div className="flex items-center justify-center py-4 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGuideId(CUSTOM_GUIDE_ID);
                    setTemplateOpen(false);
                  }}
                  className={cn(
                    "flex w-full flex-col px-3 py-2 text-left text-xs hover:bg-slate-50",
                    selectedGuideId === CUSTOM_GUIDE_ID && "bg-slate-50"
                  )}
                >
                  <span className="font-semibold text-slate-800">Custom</span>
                  <span className="text-slate-500">Describe your issue freely</span>
                </button>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedGuideId(t.id);
                      setTemplateOpen(false);
                    }}
                    className={cn(
                      "flex w-full flex-col px-3 py-2 text-left text-xs hover:bg-slate-50",
                      selectedGuideId === t.id && "bg-emerald-50"
                    )}
                  >
                    <span className="font-semibold text-slate-800">{t.title}</span>
                    <span className="text-slate-500">{t.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => submit({ voice: true })}
              title="Hands-free voice"
              className={cn(pressableSubtle, touchIconButtonCompact, "rounded-lg border border-slate-200 text-slate-600 hover:border-emerald-200 hover:bg-slate-100 hover:text-[#00634B] disabled:opacity-40")}
            >
              <Mic className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => submit()}
              disabled={disabled || (!composedMessage.trim() && attachments.length === 0)}
              className={cn(pressable, touchNavRow, "inline-flex items-center gap-1.5 rounded-lg bg-[#00634B] px-4 py-2.5 md:py-2 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 hover:bg-[#014D3C] disabled:opacity-40 disabled:active:scale-100")}
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          </div>
        </div>
        </div>
      </motion.div>

      <div className="my-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <ShortcutCard
          href="/find-help"
          icon={Users}
          title="Hire a lawyer"
          delay={0.15}
          iconClassName="text-[#00634B]"
        />
        <ShortcutCard
          href="/legal-rights"
          icon={Scale}
          title="Know your rights"
          delay={0.2}
          iconClassName="text-slate-600"
        />
        {/* Added specifically for testing AI Voice Verificator without needing a case */}
        <button
          onClick={(e) => {
            e.preventDefault();
            if (onStartChat) onStartChat("talk to ai moderator");
          }}
          className="group relative flex h-14 items-center justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all hover:border-[#00634B]/30 hover:bg-[#00634B]/5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950 dark:hover:border-emerald-900/50 dark:hover:bg-emerald-950/20"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 transition-colors group-hover:bg-white dark:bg-slate-900 dark:group-hover:bg-slate-950">
              <Users className="h-4 w-4 text-[#00634B]" />
            </span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Demo AI Verificator
            </span>
          </div>
        </button>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className="mt-5"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className={cn("text-sm font-bold", usesLightText ? "text-white" : "text-slate-900")}>
            Latest formalised case
          </h2>
          <Link
            href="/my-cases"
            className={cn(
              "text-xs font-semibold hover:underline",
              usesLightText ? "text-emerald-200" : "text-[#00634B]"
            )}
          >
            View all
          </Link>
        </div>
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.28 }}
          className="rounded-lg border border-slate-200/80 bg-white p-3.5 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{latestCase.title}</p>
              <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{latestCase.nextStep}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                statusToneClass[latestCase.statusTone]
              )}
            >
              {latestCase.status}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Shield className="h-3 w-3" />
              {latestCase.involved}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Updated {latestCase.updated}
            </span>
          </div>
        </motion.div>
      </motion.section>
      </div>
    </div>
  );
}

function ShortcutCard({
  href,
  icon: Icon,
  title,
  delay,
  iconClassName,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  delay: number;
  iconClassName?: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={delay / 0.05}
    >
      <Link
        href={href}
        className={cn(
          pressableCard,
          hoverCard,
          "group flex items-center justify-between rounded-lg border border-white/80 bg-white px-4 py-3.5 text-slate-800",
          "shadow-[0_4px_14px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)]"
        )}
      >
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md bg-white",
              "shadow-[inset_0_2px_5px_rgba(0,0,0,0.07),inset_0_-2px_4px_rgba(255,255,255,1),0_1px_2px_rgba(0,0,0,0.04)]",
              iconClassName
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">{title}</span>
        </span>
        <ArrowRight className="h-4 w-4 text-slate-400 transition-[transform,color] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-[#00634B]" />
      </Link>
    </motion.div>
  );
}
