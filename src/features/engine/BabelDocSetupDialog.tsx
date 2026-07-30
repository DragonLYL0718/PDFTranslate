import { Suspense, lazy, useState } from "react";
import { Copy, CheckCircle2, XCircle, Loader2, Download, ExternalLink } from "lucide-react";
import { Modal } from "@/components/Modal";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { useBabelDocDialog } from "@/store/babeldocDialog";
import { pingEngineB, resetEngineBProbe } from "@/features/engine/engineB";
import { patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { isDesktop } from "@/platform";

// Behind the build-time flag, not just lazy: `lazy(() => import(…))` on its own
// still emits the chunk, @tauri-apps runtime and all, into the web bundle. The
// folded ternary is what makes the import unreachable so Rollup drops it.
const InstallPanel = isDesktop
  ? lazy(() => import("./BabelDocInstallPanel").then((m) => ({ default: m.BabelDocInstallPanel })))
  : undefined;

const BASE = import.meta.env.BASE_URL; // e.g. "/PDFTranslate/" or "/"
const SCRIPT_URL = new URL(`${BASE}install-babeldoc.mjs`, location.origin).href;
/** The page URL the user is currently on — what they return to after setup. */
const APP_URL = `${location.origin}${BASE}`.replace(/\/+$/, "/");

/** This repo, as recorded in backend/pyproject.toml. */
const DEFAULT_REPO_URL = "https://github.com/DragonLYL0718/PDFTranslate";

/**
 * The repo the backend package is installed from. VITE_REPO_URL wins so a fork
 * can point the command at itself; failing that a `*.github.io` Pages host
 * still names the fork in its own hostname. The default matters because the
 * hostname carries no such hint on a custom domain, in the desktop shell, or in
 * local dev — where this used to emit an unusable placeholder.
 */
function deriveGitUrl(): string {
  const configured = import.meta.env.VITE_REPO_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = BASE.replace(/\//g, "");
  if (m && repo) return `https://github.com/${m[1]}/${repo}`;
  return DEFAULT_REPO_URL;
}
const GIT_URL = deriveGitUrl();
/** pip/uv requirement spec that installs the backend package from the repo's `backend/` subdir. */
const BACKEND_SPEC = `git+${GIT_URL}.git#subdirectory=backend`;

/** Concatenate multi-line commands with && so one copy fits the terminal. */
function join(parts: string[]) {
  return parts.join(" && ");
}

export function BabelDocSetupDialog() {
  const { open, hide } = useBabelDocDialog();
  const settings = useSettings();
  const [copiedKey, setCopied] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [source, setSource] = useState<string | null>(null);

  if (!open) return null;

  // The shell installs and runs the backend itself, so none of the terminal
  // instructions below apply there.
  if (isDesktop && InstallPanel) {
    return (
      <Modal
        open={open}
        onClose={hide}
        title={t("babeldoc.title")}
        footer={<button className={cn(styles.button, styles.press)} onClick={hide}>{t("prune.done")}</button>}
      >
        <Suspense fallback={<p className={styles.muted}>{t("reader.loading")}</p>}>
          <InstallPanel />
        </Suspense>
      </Modal>
    );
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); } catch {}
  }

  async function test() {
    setTesting(true);
    setReachable(null);
    const ok = await pingEngineB(settings.babelDocUrl);
    setReachable(ok);
    setTesting(false);
    if (ok) {
      resetEngineBProbe();
      if (settings.lastOptions.engine !== "babeldoc") {
        await patchSettings({ lastOptions: { ...settings.lastOptions, engine: "babeldoc" } });
      }
    }
  }

  async function loadSource() {
    if (source !== null) return;
    try { setSource(await (await fetch(SCRIPT_URL)).text()); }
    catch { setSource(t("babeldoc.sourceLoadFailed")); }
  }

  function CmdBlock({ lines, label }: { lines: string[]; label: string }) {
    const text = join(lines);
    return (
      <div className="flex gap-2">
        <code className={cn(styles.kbd, "flex-1 truncate px-3 py-2 text-sm")}>{text}</code>
        <button className={cn(styles.buttonGhost, styles.press, "shrink-0 px-3")} onClick={() => copy(text, label)}>
          <Copy className="size-3.5" /> {copiedKey === label ? t("proxy.copied") : t("proxy.copy")}
        </button>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={hide}
      title={t("babeldoc.title")}
      footer={<button className={cn(styles.button, styles.press)} onClick={hide}>{t("prune.done")}</button>}
    >
      <div className="flex flex-col gap-5">
        <div className={cn(styles.card, "border-accent/20 bg-accent/5 p-3")}>
          <p className={cn("text-xs", styles.muted)}>
            {t("babeldoc.howTo")}
          </p>
        </div>

        <p className={styles.muted}>
          {/* Two halves of one sentence, split around the link. */}
          {t("babeldoc.introA")}
          <a href="https://github.com/funstory-ai/babeldoc" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent underline">funstory-ai/babeldoc <ExternalLink className="size-3" /></a>
          {t("babeldoc.introB")}
        </p>

        {/* ── Option A: install with uv (recommended) ── */}
        <div className="flex flex-col gap-2 rounded-control border border-border-subtle p-3">
          <label className="text-xs font-semibold text-text-2">{t("babeldoc.methodA")}</label>
          <p className="text-xs text-text-3">
            {t("babeldoc.uvNeedA")}
            <a href="https://docs.astral.sh/uv/getting-started/installation/" target="_blank" rel="noopener noreferrer" className="text-accent underline">uv</a>
            {t("babeldoc.uvNeedB")}
          </p>
          <CmdBlock lines={["curl -LsSf https://astral.sh/uv/install.sh | sh"]} label="uv" />

          <div className="mt-1">
            <p className="text-xs font-medium text-text-3 mb-1">{t("babeldoc.stepInstall")}</p>
            <CmdBlock lines={["uv tool install --python 3.12 BabelDOC"]} label="babeldoc" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-3 mb-1">{t("babeldoc.stepBackend")}</p>
            <CmdBlock lines={[`uv tool install --python 3.12 "${BACKEND_SPEC}"`]} label="backend" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-3 mb-1">{t("babeldoc.stepRun")}</p>
            <CmdBlock lines={["pdftranslate-backend"]} label="run" />
          </div>
          <p className="text-xs text-text-3 mt-1">
            {t("babeldoc.afterRun")} <code className="text-text-2">pdftranslate-backend</code>
          </p>
        </div>

        {/* ── Option B: one-line script (optional, needs Node.js) ── */}
        <details className="rounded-control border border-border-subtle">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-2">
            {t("babeldoc.methodB")}
          </summary>
          <div className="border-t border-border-subtle p-3 flex flex-col gap-1.5">
            <p className="text-xs text-text-3">
              {t("babeldoc.methodBDesc")}
            </p>
            <CmdBlock
              lines={[`curl -fsSL ${SCRIPT_URL} | PDFT_GIT="${GIT_URL}" PDFT_APP="${APP_URL}" node --input-type=module`]}
              label="script"
            />
          </div>
        </details>

        {/* ── Connection test ── */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-2">{t("babeldoc.testTitle")}</label>
          <p className="text-xs text-text-3">{t("babeldoc.testDesc")}</p>
          <div className="flex gap-2">
            <input
              className={cn(styles.input, "flex-1 font-mono")}
              value={settings.babelDocUrl}
              onChange={(e) => patchSettings({ babelDocUrl: e.target.value })}
            />
            <button className={cn(styles.buttonGhost, styles.press, "shrink-0")} onClick={test} disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("babeldoc.test")}
            </button>
          </div>
          {reachable === true && (
            <span className="flex items-center gap-1 text-xs text-accent">
              <CheckCircle2 className="size-3.5" /> {t("babeldoc.connected")}
            </span>
          )}
          {reachable === false && (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1 text-xs text-red-500">
                <XCircle className="size-3.5" /> {t("babeldoc.unreachable")}
              </span>
              <ul className="text-xs text-text-3 list-disc ml-5">
                {/* Each tip ends with its command so one message key covers the sentence. */}
                <li>{t("babeldoc.tipRunning")} <code className="text-text-2">pdftranslate-backend</code></li>
                <li>{t("babeldoc.tipInstalled")} <code className="text-text-2">babeldoc --version</code></li>
                <li>{t("babeldoc.tipHealth")} <code className="text-text-2">curl http://localhost:8787/api/health</code></li>
                <li>{t("babeldoc.tipHttp")} <code className="text-text-2">http://localhost:8787</code></li>
                {/* Hosted over https, the browser — always Safari, sometimes
                    Chrome's local-network prompt — may refuse to reach a local
                    address at all. The backend serves this same app, so its own
                    origin is the way out. */}
                {location.protocol === "https:" && (
                  <li>
                    {t("babeldoc.tipHttps")}{" "}
                    <a href={settings.babelDocUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                      {settings.babelDocUrl}
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* ── Source transparency ── */}
        <details className="rounded-control border border-border-subtle" onToggle={loadSource}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-2">{t("babeldoc.viewSource")}</summary>
          <div className="border-t border-border-subtle p-3">
            <a href={SCRIPT_URL} download="install-babeldoc.mjs" className={cn(styles.buttonGhost, styles.press, "mb-2 inline-flex gap-1 px-3 py-1.5 text-xs")}>
              <Download className="size-3.5" /> {t("babeldoc.download")}
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
