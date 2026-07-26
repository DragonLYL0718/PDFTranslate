import { useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Modal } from "@/components/Modal";
import { setLocale, t } from "@/i18n";
import { saveCustomLocale } from "@/i18n/customStore";
import { generateLocale, identifyLanguage, makeMeta, pickProvider } from "@/i18n/generate";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";

interface Done {
  localeId: string;
  endonym: string;
  ok: number;
  total: number;
  saved: boolean;
}

export function GenerateLocaleDialog({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const [input, setInput] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setProgress(null);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      const provider = await pickProvider();
      const identity = await identifyLanguage(provider, input, signal);
      const result = await generateLocale(provider, identity, {
        signal,
        onProgress: (d, total) => setProgress({ done: d, total }),
      });
      const meta = makeMeta(identity, result.ok);
      const saved = saveCustomLocale(meta, result.messages);
      setDone({ localeId: `custom:${meta.id}`, endonym: identity.endonym, ...result, saved });
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    abort.current?.abort();
    onClose();
  }

  // Activating remounts the tree, so it has to be an explicit action — doing it
  // automatically would tear this dialog down before the result is read.
  function use() {
    if (done) setLocale(done.localeId);
    onClose();
  }

  return (
    <Modal
      open
      onClose={cancel}
      title={t("locale.generateTitle")}
      footer={
        done ? (
          <>
            <button className={cn(styles.buttonGhost, styles.press)} onClick={onClose}>
              {t("common.close")}
            </button>
            <button className={cn(styles.button, styles.press)} onClick={use}>
              {t("locale.use")}
            </button>
          </>
        ) : (
          <>
            <button className={cn(styles.buttonGhost, styles.press)} onClick={cancel}>
              {t("common.cancel")}
            </button>
            <button
              className={cn(styles.button, styles.press)}
              onClick={run}
              disabled={busy || !input.trim()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {t("locale.start")}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {done ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-2">
              {done.ok === done.total
                ? t("locale.doneAll", { ok: done.ok, name: done.endonym })
                : t("locale.donePartial", {
                    ok: done.ok,
                    total: done.total,
                    miss: done.total - done.ok,
                  })}
            </p>
            {!done.saved && <p className="text-sm text-amber-500">{t("locale.saveFailed")}</p>}
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-2">{t("locale.inputLabel")}</span>
              <input
                className={styles.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && input.trim() && run()}
                placeholder={t("locale.inputPlaceholder")}
                disabled={busy}
                autoFocus
              />
              <span className="text-xs text-text-3">{t("locale.inputHint")}</span>
            </label>

            <p className="text-xs text-text-3">{t("locale.costNote")}</p>

            {busy && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-text-2">
                  <span>{t("locale.generating")}</span>
                  {progress && (
                    <span className="font-mono">
                      {t("locale.progress", { done: progress.done, total: progress.total })}
                    </span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{ width: progress ? `${(progress.done / progress.total) * 100}%` : "5%" }}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-500">{t("locale.failed", { error })}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
