import { useState } from "react";
import { Copy, CheckCircle2, XCircle, Loader2, Download, ExternalLink } from "lucide-react";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { useBabelDocDialog } from "@/store/babeldocDialog";
import { pingEngineB, resetEngineBProbe } from "@/features/engine/engineB";
import { patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";

const BASE = import.meta.env.BASE_URL; // e.g. "/PDFTranslate/" or "/"
const SCRIPT_URL = new URL(`${BASE}install-babeldoc.mjs`, location.origin).href;
/** The page URL the user is currently on — what they return to after setup. */
const APP_URL = `${location.origin}${BASE}`.replace(/\/+$/, "/");

/**
 * Derive the GitHub repo URL from a `*.github.io` Pages host.
 * `lylrayleigh.github.io/PDFTranslate/` → `https://github.com/lylrayleigh/PDFTranslate`.
 * Falls back to a placeholder off github.io (e.g. local dev).
 */
function deriveGitUrl(): string {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = BASE.replace(/\//g, "");
  if (m && repo) return `https://github.com/${m[1]}/${repo}`;
  return "https://github.com/<你的用户名>/<仓库名>";
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
    catch { setSource("// 无法加载"); }
  }

  function CmdBlock({ lines, label }: { lines: string[]; label: string }) {
    const text = join(lines);
    return (
      <div className="flex gap-2">
        <code className={cn(styles.kbd, "flex-1 truncate px-3 py-2 text-sm")}>{text}</code>
        <button className={cn(styles.buttonGhost, styles.press, "shrink-0 px-3")} onClick={() => copy(text, label)}>
          <Copy className="size-3.5" /> {copiedKey === label ? "已复制" : "复制"}
        </button>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={hide}
      title="安装 BabelDOC（高保真引擎）"
      footer={<button className={cn(styles.button, styles.press)} onClick={hide}>完成</button>}
    >
      <div className="flex flex-col gap-5">
        <div className={cn(styles.card, "border-accent/20 bg-accent/5 p-3")}>
          <p className={cn("text-xs", styles.muted)}>
            💡 <strong>如何使用</strong>：在本地安装并运行 BabelDOC 后端服务，该应用会自动检测到它。所有翻译数据只保存在你的设备上，无需云服务。
          </p>
        </div>

        <p className={styles.muted}>
          BabelDOC 是开源 PDF 翻译引擎，提供高保真的排版保留效果。
          从 <a href="https://github.com/funstory-ai/babeldoc" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent underline">funstory-ai/babeldoc <ExternalLink className="size-3" /></a> 安装。
        </p>

        {/* ── 方式 A：uv 安装（推荐） ── */}
        <div className="flex flex-col gap-2 rounded-control border border-border-subtle p-3">
          <label className="text-xs font-semibold text-text-2">方式 A — 用 uv 安装（推荐，无需 Node）</label>
          <p className="text-xs text-text-3">
            需要 <a href="https://docs.astral.sh/uv/getting-started/installation/" target="_blank" rel="noopener noreferrer" className="text-accent underline">uv</a>。没有的话先装（装完重启终端）：
          </p>
          <CmdBlock lines={["curl -LsSf https://astral.sh/uv/install.sh | sh"]} label="uv" />

          <div className="mt-1">
            <p className="text-xs font-medium text-text-3 mb-1">① 安装 BabelDOC（隔离 Python 3.12）</p>
            <CmdBlock lines={["uv tool install --python 3.12 BabelDOC"]} label="babeldoc" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-3 mb-1">② 安装本应用的后端服务</p>
            <CmdBlock lines={[`uv tool install --python 3.12 "${BACKEND_SPEC}"`]} label="backend" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-3 mb-1">③ 启动后端（保持窗口打开）</p>
            <CmdBlock lines={["pdftranslate-backend"]} label="run" />
          </div>
          <p className="text-xs text-text-3 mt-1">
            启动后回到本页点下方「测试连接」即可。之后每次只需再运行 <code className="text-text-2">pdftranslate-backend</code>。
          </p>
        </div>

        {/* ── 方式 B：一键脚本（可选，需 Node.js） ── */}
        <details className="rounded-control border border-border-subtle">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-2">
            方式 B — 一键脚本（可选，需 Node.js）
          </summary>
          <div className="border-t border-border-subtle p-3 flex flex-col gap-1.5">
            <p className="text-xs text-text-3">
              自动完成方式 A 的全部步骤。仅当你已装 Node.js 时使用：
            </p>
            <CmdBlock
              lines={[`curl -fsSL ${SCRIPT_URL} | PDFT_GIT="${GIT_URL}" PDFT_APP="${APP_URL}" node --input-type=module`]}
              label="script"
            />
          </div>
        </details>

        {/* ── 测试连接 ── */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-2">测试连接</label>
          <p className="text-xs text-text-3">启动后端后点此验证：</p>
          <div className="flex gap-2">
            <input
              className={cn(styles.input, "flex-1 font-mono")}
              value={settings.babelDocUrl}
              onChange={(e) => patchSettings({ babelDocUrl: e.target.value })}
            />
            <button className={cn(styles.buttonGhost, styles.press, "shrink-0")} onClick={test} disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : null}
              测试
            </button>
          </div>
          {reachable === true && (
            <span className="flex items-center gap-1 text-xs text-accent">
              <CheckCircle2 className="size-3.5" /> 已连接！回到翻译对话框可选高保真引擎。
            </span>
          )}
          {reachable === false && (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1 text-xs text-red-500">
                <XCircle className="size-3.5" /> 连不上后端
              </span>
              <ul className="text-xs text-text-3 list-disc ml-5">
                <li>确认后端已启动：运行 <code className="text-text-2">pdftranslate-backend</code>，终端应显示 "Application startup complete"</li>
                <li>检查 BabelDOC 是否安装：运行 <code className="text-text-2">babeldoc --version</code></li>
                <li>验证后端健康：<code className="text-text-2">curl http://localhost:8787/api/health</code></li>
                <li>地址须为 <code className="text-text-2">http://localhost:8787</code>（http，非 https）</li>
              </ul>
            </div>
          )}
        </div>

        {/* ── 源码透明 ── */}
        <details className="rounded-control border border-border-subtle" onToggle={loadSource}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-2">查看安装脚本源码</summary>
          <div className="border-t border-border-subtle p-3">
            <a href={SCRIPT_URL} download="install-babeldoc.mjs" className={cn(styles.buttonGhost, styles.press, "mb-2 inline-flex gap-1 px-3 py-1.5 text-xs")}>
              <Download className="size-3.5" /> 下载
            </a>
            <pre className="max-h-64 overflow-auto rounded-control bg-surface-2 p-3 font-mono text-xs pretty-scrollbar">
              {source ?? "加载中…"}
            </pre>
          </div>
        </details>
      </div>
    </Modal>
  );
}
