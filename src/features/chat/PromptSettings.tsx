import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { getLocale, t, type PlainKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import type { RagIndex } from "@/types";
import {
  builtInSummaryPrompt,
  localeLanguageName,
  resetSummaryPrompt,
  resolveSummaryPrompt,
  saveSummaryPrompt,
} from "./prompts";
import { generateSummaryPrompt } from "./prompts";
import { pickChatProvider } from "./runChat";

const CHUNK_OPTIONS: { value: number; labelKey: PlainKey }[] = [
  { value: 3, labelKey: "chat.chunksFew" },
  { value: 6, labelKey: "chat.chunksNormal" },
  { value: 10, labelKey: "chat.chunksMany" },
];

interface Props {
  index: RagIndex | null;
  onRebuild: () => void;
  onRegenerateSummary?: () => void;
  onClose: () => void;
}

export function PromptSettings({ index, onRebuild, onRegenerateSummary, onClose }: Props) {
  const settings = useSettings();
  const locale = getLocale();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const hasOverride = !!settings.chatSummaryPrompts[locale];

  useEffect(() => {
    resolveSummaryPrompt(locale).then((r) => setPrompt(r.text));
  }, [locale, settings.chatSummaryPrompts]);

  // Same outside-click dismissal as the reader's export menu.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  async function regeneratePrompt() {
    setBusy(true);
    setError(null);
    try {
      const provider = await pickChatProvider();
      setPrompt(await generateSummaryPrompt(provider, locale));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={ref}
      className={cn(styles.card, "absolute right-0 top-full z-20 mt-1 flex w-88 flex-col gap-3 p-3")}
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("chat.prompt.title")}</span>
          <span className="text-xs text-text-3">
            {t("chat.prompt.locale", { locale: localeLanguageName(locale) })}
          </span>
        </div>
        <textarea
          className={cn(styles.textarea, "mt-1.5 h-48 font-mono text-xs")}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => {
            if (prompt.trim()) saveSummaryPrompt(locale, prompt);
          }}
          onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {hasOverride && (
            <button
              className={cn(styles.buttonGhost, styles.press, "px-2 py-1 text-xs")}
              onClick={() => resetSummaryPrompt(locale)}
            >
              <RotateCcw className="size-3.5" /> {t("chat.prompt.reset")}
            </button>
          )}
          {/* Only offered where there is no hand-written preset to fall back to. */}
          {!builtInSummaryPrompt(locale) && (
            <button
              className={cn(styles.buttonGhost, styles.press, "px-2 py-1 text-xs")}
              onClick={regeneratePrompt}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {t(busy ? "chat.prompt.generating" : "chat.prompt.regenerate")}
            </button>
          )}
          {onRegenerateSummary && (
            <button
              className={cn(styles.buttonGhost, styles.press, "px-2 py-1 text-xs")}
              onClick={onRegenerateSummary}
            >
              {t("chat.regenSummary")}
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      <div className="border-t border-border-subtle pt-3">
        <div className="text-sm font-medium">{t("chat.retrievalChunks")}</div>
        <div className="mt-1.5 flex gap-2 rounded-control border border-border-subtle p-1">
          {CHUNK_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => patchSettings({ chatContextChunks: o.value })}
              className={cn(
                "flex-1 rounded px-2 py-1 text-xs transition-colors",
                settings.chatContextChunks === o.value ? "bg-accent text-white" : "hover:bg-surface-2",
              )}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 border-t border-border-subtle pt-3 text-xs text-text-2">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--accent)]"
          checked={settings.chatSuggestions}
          onChange={(e) => patchSettings({ chatSuggestions: e.target.checked })}
        />
        <span>{t("chat.suggestionsToggle")}</span>
      </label>

      <div className="flex items-center justify-between border-t border-border-subtle pt-3">
        <span className="text-xs text-text-3">
          {index
            ? t("chat.indexInfo", { chunks: index.chunks.length, pages: index.pageCount })
            : t("chat.indexMissing")}
        </span>
        <button
          className={cn(styles.buttonGhost, styles.press, "px-2 py-1 text-xs")}
          onClick={onRebuild}
        >
          {t("chat.rebuildIndex")}
        </button>
      </div>
    </div>
  );
}
