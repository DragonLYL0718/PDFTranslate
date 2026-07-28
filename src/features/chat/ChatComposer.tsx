import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import type { ChatQuote } from "@/types";

interface Props {
  quote?: ChatQuote;
  onClearQuote: () => void;
  onSend: (question: string) => void;
  onStop: () => void;
  busy: boolean;
  /** Rough size of the document context that would ride along, in tokens. */
  contextTokens: number;
}

export function ChatComposer({ quote, onClearQuote, onSend, onStop, busy, contextTokens }: Props) {
  const settings = useSettings();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to a few lines, then scroll — same imperative
  // measure-and-set approach the translation overlay uses.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function submit() {
    const question = text.trim();
    if (!question || busy) return;
    setText("");
    onSend(question);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle px-3 py-2.5">
      {quote && (
        <div className="flex items-start gap-1 rounded-control border-l-2 border-accent bg-surface-2 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-accent">
              {t(quote.side === "target" ? "chat.quoteTarget" : "chat.quoteSource", {
                page: quote.pageNumber,
              })}
            </div>
            <p className="line-clamp-2 text-xs text-text-3">{quote.text}</p>
          </div>
          <button
            onClick={onClearQuote}
            className="rounded p-0.5 text-text-3 hover:bg-surface-3"
            title={t("chat.clearQuote")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          className={cn(styles.textarea, "flex-1")}
          placeholder={t("chat.placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            // Don't let the reader's fullscreen shortcut see this.
            if (e.key === "Escape") e.stopPropagation();
          }}
        />
        <button
          onClick={busy ? onStop : submit}
          disabled={!busy && !text.trim()}
          className={cn(styles.button, styles.press, "size-9 shrink-0 p-0")}
          title={t(busy ? "chat.stop" : "chat.send")}
        >
          {busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
        </button>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-text-3">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--accent)]"
          checked={settings.chatIncludeContext}
          onChange={(e) => patchSettings({ chatIncludeContext: e.target.checked })}
        />
        <span>{t("chat.includeContext")}</span>
        <span className="ml-auto tabular-nums">
          {!settings.chatIncludeContext
            ? t("chat.contextOffHint")
            : // Before the index exists there is nothing to size, and "~0 tokens"
              // would read as though context were free.
              contextTokens > 0
              ? t("chat.contextHint", {
                  tokens: contextTokens > 999 ? `${(contextTokens / 1000).toFixed(1)}k` : contextTokens,
                })
              : ""}
        </span>
      </label>
    </div>
  );
}
