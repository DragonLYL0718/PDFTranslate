import { useState } from "react";
import { Copy, Check, CornerDownRight, RefreshCw, Sparkles } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import type { ChatMessage } from "@/types";
import { Markdown } from "./Markdown";

interface Props {
  message: ChatMessage;
  /** Live text while this message is still streaming. */
  live?: string;
  /** Jump the reader to a cited page (and, where known, its paragraph). */
  onCite?: (page: number) => void;
  /** Send one of the suggested follow-ups. Absent while a turn is running. */
  onAsk?: (question: string) => void;
  onRegenerate?: () => void;
}

export function ChatMessageView({ message, live, onCite, onAsk, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);
  const streaming = message.status === "streaming";
  const text = streaming && live !== undefined ? live : message.content;

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1 px-4 py-2">
        {message.quote && (
          <div className="max-w-[85%] rounded-card border-l-2 border-accent bg-surface-2 px-2 py-1 text-xs text-text-3">
            <span className="text-accent">
              {t(message.quote.side === "target" ? "chat.quoteTarget" : "chat.quoteSource", {
                page: message.quote.pageNumber,
              })}
            </span>
            <p className="line-clamp-3 whitespace-pre-wrap">{message.quote.text}</p>
          </div>
        )}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-card bg-accent-soft px-3 py-2 text-sm text-text-1">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-1.5 px-4 py-2">
      {message.kind === "summary" && (
        <span className={cn(styles.chip, "self-start text-accent")}>
          <Sparkles className="size-3.5" /> {t("chat.summaryLabel")}
        </span>
      )}

      <div className="text-sm leading-relaxed text-text-2">
        <Markdown text={text} onGoToPage={onCite} />
        {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />}
      </div>

      {message.status === "error" && (
        <p className="text-xs text-red-500">{t("chat.failed", { error: message.error ?? "" })}</p>
      )}
      {message.status === "aborted" && <p className="text-xs text-text-3">{t("chat.aborted")}</p>}

      {!streaming && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={copy}
            className="rounded p-1 text-text-3 hover:bg-surface-2"
            title={t("chat.copy")}
          >
            {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
          </button>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="rounded p-1 text-text-3 hover:bg-surface-2"
              title={t("chat.regenerate")}
            >
              <RefreshCw className="size-3.5" />
            </button>
          )}
          {!!message.sources?.length && (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
              {message.sources.map((page) => (
                <button
                  key={page}
                  onClick={() => onCite?.(page)}
                  disabled={!onCite}
                  className={cn(styles.chip, "px-1.5 py-0 font-mono text-[0.65rem]", onCite && "hover:border-accent hover:text-accent")}
                  title={t("chat.citePage", { page })}
                >
                  p{page}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Only offered on the latest answer: older chips would be answering a
          question the conversation has already moved past. */}
      {!streaming && !!message.followups?.length && onAsk && (
        <div className="mt-0.5 flex flex-col items-start gap-1">
          <span className="text-[0.7rem] text-text-3">{t("chat.followups")}</span>
          {message.followups.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              className="flex max-w-full items-start gap-1.5 rounded-control border border-border-subtle bg-surface-1 px-2 py-1 text-left text-xs text-text-2 transition-colors hover:border-accent hover:text-accent"
            >
              <CornerDownRight className="mt-0.5 size-3 shrink-0 text-text-3" />
              <span>{q}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
