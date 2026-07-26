import { useState } from "react";
import { Copy, Download, CheckCircle2, XCircle, Loader2, TriangleAlert, Terminal } from "lucide-react";
import { Modal } from "@/components/Modal";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { useProxyDialog } from "@/store/proxyDialog";
import { pingProxy } from "@/features/providers/net";

// The proxy script is served as a static asset, so we can run it without downloading a file.
const SCRIPT_URL = new URL(`${import.meta.env.BASE_URL}proxy.mjs`, location.origin).href;

export function ProxySetupDialog() {
  const { open, reason, hide } = useProxyDialog();
  const settings = useSettings();
  const [testing, setTesting] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  if (!open) return null;

  const isWin = /Windows/i.test(navigator.userAgent);
  const cmd = isWin
    ? `irm ${SCRIPT_URL} | node --input-type=module`
    : `curl -fsSL ${SCRIPT_URL} | node --input-type=module`;

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
    } catch {
      /* clipboard blocked; command is shown for manual copy */
    }
  }

  async function test() {
    setTesting(true);
    setReachable(null);
    const ok = await pingProxy(settings.proxyUrl);
    setReachable(ok);
    setTesting(false);
    if (ok && !settings.proxyEnabled) await patchSettings({ proxyEnabled: true });
  }

  async function loadSource() {
    if (source !== null) return;
    try {
      setSource(await (await fetch(SCRIPT_URL)).text());
    } catch {
      setSource(t("proxy.sourceLoadFailed"));
    }
  }

  return (
    <Modal
      open={open}
      onClose={hide}
      title={t("proxy.title")}
      footer={<button className={cn(styles.button, styles.press)} onClick={hide}>{t("prune.done")}</button>}
    >
      <div className="flex flex-col gap-4">
        {reason && (
          <div className="flex gap-2 rounded-control bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{reason}</span>
          </div>
        )}

        <p className={styles.muted}>{t("proxy.intro")}</p>

        <div className="rounded-control bg-accent-soft p-3 text-sm text-text-2">
          {t("proxy.babeldocNote")}
        </div>

        {/* Step 1: one command, no file to download or locate */}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-text-2">
            <Terminal className="size-3.5" /> {t("proxy.step1")}
          </label>
          <div className="flex gap-2">
            <code className={cn(styles.kbd, "flex-1 truncate px-3 py-2 text-sm")}>{cmd}</code>
            <button className={cn(styles.button, styles.press, "shrink-0 px-3")} onClick={copyCmd}>
              <Copy className="size-3.5" /> {copied ? t("proxy.copied") : t("proxy.copy")}
            </button>
          </div>
          <span className="text-xs text-text-3">{t("proxy.copyHint")}</span>
        </div>

        {/* Step 2: test + auto-enable */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-2">{t("proxy.step2")}</label>
          <div className="flex gap-2">
            <input
              className={cn(styles.input, "flex-1 font-mono")}
              value={settings.proxyUrl}
              onChange={(e) => patchSettings({ proxyUrl: e.target.value })}
            />
            <button className={cn(styles.buttonGhost, styles.press, "shrink-0")} onClick={test} disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("proxy.test")}
            </button>
          </div>
          {reachable === true && (
            <span className="flex items-center gap-1 text-xs text-accent">
              <CheckCircle2 className="size-3.5" /> {t("proxy.connected")}
            </span>
          )}
          {reachable === false && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <XCircle className="size-3.5" /> {t("proxy.unreachable")}
            </span>
          )}
        </div>

        <label className={cn(styles.card, "flex cursor-pointer items-center justify-between p-3")}>
          <span className="text-sm font-medium">{t("proxy.enable")}</span>
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={settings.proxyEnabled}
            onChange={(e) => patchSettings({ proxyEnabled: e.target.checked })}
          />
        </label>

        {/* Transparency: view the exact code before running it */}
        <details className="rounded-control border border-border-subtle" onToggle={loadSource}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-2">
            {t("proxy.viewSource")}
          </summary>
          <div className="border-t border-border-subtle p-3">
            <a href={SCRIPT_URL} download="proxy.mjs" className={cn(styles.buttonGhost, styles.press, "mb-2 px-3 py-1.5 text-xs")}>
              <Download className="size-3.5" /> {t("proxy.download")}
            </a>
            <pre className="max-h-64 overflow-auto rounded-control bg-surface-2 p-3 font-mono text-xs pretty-scrollbar">
              {source ?? t("reader.loading")}
            </pre>
          </div>
        </details>
      </div>
    </Modal>
  );
}
