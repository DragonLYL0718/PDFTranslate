import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Download, FolderOpen, Loader2, Play, Square, Trash2, XCircle } from "lucide-react";
import { t, useLocale } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { resetEngineBProbe } from "@/features/engine/engineB";
import { useDesktopBackend } from "@/store/desktopBackend";

/**
 * Mirrors for the two downloads most likely to be unreachable behind a slow or
 * filtered connection: python-build-standalone (GitHub) and the wheels (PyPI).
 * Kept here rather than in Rust so they stay easy to change.
 */
const MIRRORS = {
  pythonInstall: "https://gh-proxy.com/https://github.com/astral-sh/python-build-standalone/releases/download",
  pypiIndex: "https://pypi.tuna.tsinghua.edu.cn/simple",
};

interface EngineBStatus {
  installed: boolean;
  babeldoc: string | null;
  dir: string;
}

type ProvisionEvent =
  | { kind: "stage"; index: number; total: number; key: string }
  | { kind: "log"; line: string }
  | { kind: "done"; babeldoc: string | null }
  | { kind: "failed"; message: string };

export function BabelDocInstallPanel() {
  const locale = useLocale();
  const [status, setStatus] = useState<EngineBStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ index: number; total: number; key: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Chinese UI almost always means the direct downloads will be the slow path.
  const [useMirrors, setUseMirrors] = useState(locale === "zh");
  const logEnd = useRef<HTMLDivElement>(null);
  const backendUrl = useDesktopBackend((s) => s.url);

  const refresh = () => invoke<EngineBStatus>("engine_b_status").then(setStatus).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  async function install() {
    setBusy(true);
    setError(null);
    setDone(false);
    setLog([]);
    setStage(null);

    // A per-invocation channel rather than a global event: ordered, and it
    // can't leak listeners across repeated opens of this panel.
    const ch = new Channel<ProvisionEvent>();
    ch.onmessage = (ev) => {
      if (ev.kind === "stage") setStage(ev);
      else if (ev.kind === "log") setLog((prev) => [...prev.slice(-400), ev.line]);
      else if (ev.kind === "failed") setError(ev.message);
      else if (ev.kind === "done") setDone(true);
    };

    try {
      await invoke("engine_b_install", { mirrors: useMirrors ? MIRRORS : {}, ch });
      await invoke("engine_b_start");
      resetEngineBProbe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage(null);
      await refresh();
    }
  }

  async function toggleBackend() {
    setBusy(true);
    try {
      await invoke(backendUrl ? "engine_b_stop" : "engine_b_start");
      resetEngineBProbe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    if (!confirm(t("engineB.uninstallConfirm"))) return;
    setBusy(true);
    try {
      await invoke("engine_b_stop");
      await invoke("engine_b_uninstall");
      resetEngineBProbe();
      setDone(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const installed = status?.installed ?? false;

  return (
    <div className="flex flex-col gap-4">
      <p className={styles.muted}>{t("engineB.intro")}</p>

      <div className={cn(styles.card, "flex items-center justify-between gap-3 p-3")}>
        <div className="min-w-0">
          <div className="font-medium">
            {installed
              ? t("engineB.statusReady", { version: status?.babeldoc ?? "BabelDOC" })
              : t("engineB.statusMissing")}
          </div>
          {installed && (
            <p className={styles.muted}>
              {backendUrl ? t("engineB.statusRunning") : t("engineB.statusStopped")}
            </p>
          )}
        </div>
        <button
          className={cn(styles.button, styles.press, "shrink-0")}
          onClick={install}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {busy ? t("engineB.installing") : installed ? t("engineB.reinstall") : t("engineB.install")}
        </button>
      </div>

      {!installed && !busy && <p className="text-xs text-text-3">{t("engineB.sizeWarning")}</p>}

      {!installed && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={useMirrors}
            onChange={(e) => setUseMirrors(e.target.checked)}
            disabled={busy}
          />
          {t("engineB.mirrors")}
        </label>
      )}

      {stage && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-text-2">
            {/* Rust sends the i18n key, not a display string, so the stage
                names stay translatable — cast because it picks from a subset. */}
            <span>{t(stage.key as "engineB.stage.check")}</span>
            <span className="text-text-3">
              {t("engineB.stageOf", { index: stage.index, total: stage.total })}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${(stage.index / stage.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {done && (
        <span className="flex items-center gap-1 text-xs text-accent">
          <CheckCircle2 className="size-3.5" /> {t("engineB.done")}
        </span>
      )}
      {error && (
        <span className="flex items-start gap-1 text-xs text-red-500">
          <XCircle className="mt-0.5 size-3.5 shrink-0" /> {t("engineB.failed", { error })}
        </span>
      )}

      {/* A multi-minute install that shows nothing reads as a hang, so every
          line uv prints goes here. */}
      {log.length > 0 && (
        <details className="rounded-control border border-border-subtle" open={busy}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-2">
            {t("engineB.details")}
          </summary>
          <div className="max-h-64 overflow-auto border-t border-border-subtle p-3 pretty-scrollbar">
            <pre className="font-mono text-xs whitespace-pre-wrap">{log.join("\n")}</pre>
            <div ref={logEnd} />
          </div>
        </details>
      )}

      {installed && (
        <div className="flex flex-wrap gap-2">
          <button
            className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")}
            onClick={toggleBackend}
            disabled={busy}
          >
            {backendUrl ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
            {backendUrl ? t("engineB.stop") : t("engineB.start")}
          </button>
          <button
            className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")}
            onClick={() => status && revealItemInDir(status.dir)}
            disabled={busy}
          >
            <FolderOpen className="size-3.5" /> {t("engineB.openDir")}
          </button>
          <button
            className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs text-red-500")}
            onClick={uninstall}
            disabled={busy}
          >
            <Trash2 className="size-3.5" /> {t("engineB.uninstall")}
          </button>
        </div>
      )}

      <p className="text-xs text-text-3">{t("engineB.managedNote")}</p>
    </div>
  );
}
