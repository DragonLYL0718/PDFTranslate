import { useState } from "react";
import { Copy, Download, CheckCircle2, XCircle, Loader2, TriangleAlert, Terminal } from "lucide-react";
import { Modal } from "@/components/Modal";
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
      setSource("// 无法加载脚本源码，请检查网络。");
    }
  }

  return (
    <Modal
      open={open}
      onClose={hide}
      title="使用本地代理"
      footer={<button className={cn(styles.button, styles.press)} onClick={hide}>完成</button>}
    >
      <div className="flex flex-col gap-4">
        {reason && (
          <div className="flex gap-2 rounded-control bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{reason}</span>
          </div>
        )}

        <p className={styles.muted}>
          这个提供商可能不支持浏览器直连（CORS）。用一个本机小脚本转发即可解决，数据仍只在
          <b> 你的浏览器 → localhost → 提供商 </b>之间。出于安全，浏览器无法自动运行本地程序，
          所以需要你在终端粘贴一次命令启动它（<b>无需下载文件</b>）。
        </p>

        <div className="rounded-control bg-accent-soft p-3 text-sm text-text-2">
          已在运行 <b>BabelDOC 高保真后端</b>？它已内置转发功能，<b>无需再启动本代理</b>——
          确保后端在运行，翻译时会自动经它转发。下面的脚本仅供未使用后端时的轻量替代。
        </div>

        {/* Step 1: one command, no file to download or locate */}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-text-2">
            <Terminal className="size-3.5" /> ① 打开终端，粘贴运行（需 Node 18+）
          </label>
          <div className="flex gap-2">
            <code className={cn(styles.kbd, "flex-1 truncate px-3 py-2 text-sm")}>{cmd}</code>
            <button className={cn(styles.button, styles.press, "shrink-0 px-3")} onClick={copyCmd}>
              <Copy className="size-3.5" /> {copied ? "已复制" : "复制"}
            </button>
          </div>
          <span className="text-xs text-text-3">命令会从本站拉取脚本并运行；可在下方「查看源码」核对安全性。</span>
        </div>

        {/* Step 2: test + auto-enable */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-2">② 回来测试连接（成功后自动启用）</label>
          <div className="flex gap-2">
            <input
              className={cn(styles.input, "flex-1 font-mono")}
              value={settings.proxyUrl}
              onChange={(e) => patchSettings({ proxyUrl: e.target.value })}
            />
            <button className={cn(styles.buttonGhost, styles.press, "shrink-0")} onClick={test} disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : null}
              测试连接
            </button>
          </div>
          {reachable === true && (
            <span className="flex items-center gap-1 text-xs text-accent">
              <CheckCircle2 className="size-3.5" /> 已连接，本地代理已启用
            </span>
          )}
          {reachable === false && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <XCircle className="size-3.5" /> 连不上，请确认命令已运行、端口一致
            </span>
          )}
        </div>

        <label className={cn(styles.card, "flex cursor-pointer items-center justify-between p-3")}>
          <span className="text-sm font-medium">启用本地代理（所有提供商请求经此转发）</span>
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
            查看源码（可核对无恶意代码）
          </summary>
          <div className="border-t border-border-subtle p-3">
            <a href={SCRIPT_URL} download="proxy.mjs" className={cn(styles.buttonGhost, styles.press, "mb-2 px-3 py-1.5 text-xs")}>
              <Download className="size-3.5" /> 下载 proxy.mjs（也可保存后 node proxy.mjs 运行）
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
