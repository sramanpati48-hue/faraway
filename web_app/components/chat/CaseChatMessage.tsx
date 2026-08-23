"use client";

import { memo, type ComponentProps } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle, Copy, FileText, User } from "lucide-react";
import { Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { StructuredReport } from "@/components/chat/StructuredReport";
import { ActionButtons } from "@/components/chat/ActionButtons";
import { stripClassificationFromChat } from "@/lib/stripClassification";
import { cn } from "@/lib/utils";

export interface CaseChatMessageData {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  attachments?: { name: string; content_type?: string }[];
}

const MARKDOWN_COMPONENTS: ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-5 border-b border-slate-100 pb-1 text-xl font-bold text-slate-900 dark:border-slate-700 dark:text-white">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-lg font-bold text-slate-800 dark:text-slate-100">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-base font-bold text-[#00634B]">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-[1.85]">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-bold text-slate-900 dark:text-white">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-slate-600 dark:text-slate-400">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-3 list-outside list-disc space-y-2 pl-5 marker:text-[#00634B]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-outside list-decimal space-y-2 pl-5 marker:font-bold marker:text-[#00634B]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-1 leading-[1.75]">
      <div className="min-w-0">{children}</div>
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-md bg-emerald-50/80 px-4 py-2 text-sm italic text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }: any) => {
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock || (!props.inline && String(children).includes("\n"))) {
      return (
        <pre className="my-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <code className={className}>{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-[#00634B] dark:bg-slate-700 dark:text-emerald-400">
        {children}
      </code>
    );
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-[#00634B] underline underline-offset-2 transition-colors hover:text-[#004D3C] dark:text-emerald-400 dark:hover:text-emerald-300"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-4 border-slate-100 dark:border-slate-700" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="min-w-full overflow-hidden rounded-lg border border-slate-200 text-sm dark:border-slate-700">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[#E6F0ED]/60 dark:bg-emerald-900/20">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider text-[#00634B]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-t border-slate-100 px-4 py-2 dark:border-slate-700">{children}</td>
  ),
};

function ValidationAnimation({ isVerified }: { isVerified: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-3 motion-enter-fade">
      {isVerified ? (
        <>
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/20">
            <CheckCircle className="h-3 w-3 text-emerald-600" />
          </div>
          <span className="text-sm font-semibold text-emerald-600">Verified by Legal Moderator</span>
        </>
      ) : (
        <>
          <div className="relative h-5 w-5">
            <div className="absolute inset-0 rounded-full border-2 border-slate-200 opacity-20" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-t-[#00634B]" />
          </div>
          <span className="chat-shimmer text-sm font-medium">Forwarding to Legal Moderator…</span>
        </>
      )}
    </div>
  );
}

export type CaseChatMessageProps = {
  msg: CaseChatMessageData;
  index: number;
  isLast: boolean;
  isNew: boolean;
  isStreaming?: boolean;
  structuredReport: any;
  suggestedActions: any[];
  copiedIndex: number | null;
  handleCopy: (text: string, index: number) => void;
  handleChecklistSelect: (item: string) => void;
  handleAction: (action: any) => void;
};

function CaseChatMessageBase({
  msg,
  index,
  isLast,
  isNew,
  isStreaming,
  structuredReport,
  suggestedActions,
  copiedIndex,
  handleCopy,
  handleChecklistSelect,
  handleAction,
}: CaseChatMessageProps) {
  const isUser = msg.role === "user";

  return (
    <Message
      align={isUser ? "end" : "start"}
      className={cn("max-w-3xl mx-auto w-full gap-3 overflow-visible", isNew && "motion-enter-fade")}
    >
      <MessageAvatar
        className={cn(
          "!translate-y-0 size-10 self-start rounded-xl border p-0 shadow-sm",
          isUser
            ? "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
            : "border-[#00634B]/15 bg-[#E6F0ED] p-1.5 dark:border-emerald-500/20 dark:bg-emerald-900/30"
        )}
      >
        {isUser ? (
          <User className="size-5 text-slate-400 dark:text-slate-300" />
        ) : (
          <div className="relative size-full">
            <Image src="/3.png" alt="" fill className="object-contain dark:hidden" />
            <Image src="/2.png" alt="" fill className="object-contain hidden dark:block" />
          </div>
        )}
      </MessageAvatar>

      <MessageContent className={cn("gap-3", isUser ? "items-end" : "items-start")}>
        {!isUser && msg.agent && (
          <MessageHeader className="px-0">
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] shadow-sm",
                msg.agent.toLowerCase() === "scam"
                  ? "border-red-100 bg-red-50 text-red-600"
                  : "border-[#00634B]/15 bg-white text-[#00634B] dark:border-emerald-800 dark:bg-slate-800 dark:text-emerald-300"
              )}
            >
              <span className="size-1.5 rounded-full bg-current animate-pulse" />
              {msg.agent}
            </span>
          </MessageHeader>
        )}

        <Bubble
          variant={isUser ? "tinted" : "outline"}
          align={isUser ? "end" : "start"}
          className="max-w-[min(100%,42rem)]"
        >
          <BubbleContent
            className={cn(
              "group/copy relative text-[15px] leading-[1.8]",
              isUser
                ? "rounded-2xl rounded-tr-md px-5 py-3.5 font-semibold shadow-[0_6px_18px_-10px_rgba(0,99,75,0.45)]"
                : "rounded-2xl rounded-tl-md border-slate-200/90 bg-white px-6 py-5 shadow-[0_10px_30px_-16px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-800"
            )}
          >
            {isUser ? (
              <div className="text-left">
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {msg.attachments.map((file) => (
                      <span
                        key={file.name}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-[#00634B] ring-1 ring-[#00634B]/15 dark:bg-emerald-950/40 dark:text-emerald-200"
                      >
                        <FileText className="size-3 shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </span>
                    ))}
                  </div>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ) : !msg.content && isStreaming ? (
              <p className="chat-shimmer text-sm font-medium">Generating response…</p>
            ) : (
              <div className="prose-custom break-words text-slate-700 dark:text-slate-300">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {stripClassificationFromChat(msg.content || "…")}
                </ReactMarkdown>
                {isStreaming && (
                  <div className="mt-2 flex items-center gap-2 text-xs font-medium text-[#00634B]">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00634B] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00634B]" />
                    </span>
                    <span className="chat-shimmer">Analyzing case &amp; formulating questions…</span>
                  </div>
                )}
              </div>
            )}

            {!isUser && msg.content && !isStreaming && (
              <button
                type="button"
                onClick={() => handleCopy(msg.content, index)}
                title="Copy to clipboard"
                className="absolute bottom-3 right-3 rounded-lg border border-slate-100 bg-white p-2 text-slate-300 opacity-0 shadow-sm transition-[opacity,color] duration-150 ease-out hover:text-[#00634B] group-hover/copy:opacity-100 motion-press-subtle dark:border-slate-600 dark:bg-slate-700"
              >
                {copiedIndex === index ? (
                  <CheckCircle size={14} className="text-[#00634B]" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            )}
          </BubbleContent>
        </Bubble>

        {!isUser && isLast && !isStreaming && (
          <MessageFooter className="w-full flex-col items-stretch gap-3 px-0">
            {structuredReport && (
              <StructuredReport report={structuredReport} onChecklistSelect={handleChecklistSelect} />
            )}
            {msg.agent === "legal_moderator" && (
              <ValidationAnimation isVerified={true} />
            )}
            {suggestedActions.length > 0 && (
              <div className="md:hidden">
                <ActionButtons actions={suggestedActions} onSelect={handleAction} />
              </div>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

function caseChatMessagePropsEqual(prev: CaseChatMessageProps, next: CaseChatMessageProps): boolean {
  if (prev.msg !== next.msg) return false;
  if (prev.isLast !== next.isLast) return false;
  if (prev.isNew !== next.isNew) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.index !== next.index) return false;
  if ((prev.copiedIndex === prev.index) !== (next.copiedIndex === next.index)) return false;
  if (next.isLast) {
    if (prev.structuredReport !== next.structuredReport) return false;
    if (prev.suggestedActions !== next.suggestedActions) return false;
  }
  return true;
}

export const CaseChatMessage = memo(CaseChatMessageBase, caseChatMessagePropsEqual);
