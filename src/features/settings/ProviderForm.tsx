import { useState } from "react";
import { Eye, EyeOff, ListRestart, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { PROVIDER_PRESETS } from "@/features/providers/presets";
import { fetchModels } from "@/features/providers/models";
import { upsertProvider } from "@/features/providers/store";
import { isNetworkError } from "@/features/providers/net";
import { useProxyDialog } from "@/store/proxyDialog";
import { useSettings } from "@/store/useSettings";
import type { Provider, ReasoningLevel } from "@/types";

const REASONING: { value: ReasoningLevel; label: string }[] = [
  { value: "off", label: "关（推荐）" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

interface Props {
  initial: Provider;
  isNew: boolean;
  onClose: () => void;
}

export function ProviderForm({ initial, isNew, onClose }: Props) {
  const settings = useSettings();
  const showProxy = useProxyDialog((s) => s.show);
  const [p, setP] = useState<Provider>(initial);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelMsg, setModelMsg] = useState<string | null>(null);

  const set = (patch: Partial<Provider>) => setP((prev) => ({ ...prev, ...patch }));

  function applyPreset(key: string) {
    const preset = PROVIDER_PRESETS.find((x) => x.key === key);
    if (preset) set({ name: preset.name, kind: preset.kind, baseURL: preset.baseURL, model: preset.model });
  }

  async function loadModels() {
    setLoadingModels(true);
    setModelMsg(null);
    try {
      const list = await fetchModels(p);
      setModels(list);
      setModelMsg(list.length ? `拉取到 ${list.length} 个模型` : "未返回模型列表");
    } catch (e) {
      setModelMsg(e instanceof Error ? `${e.message}｜可手动输入` : "拉取失败");
      // Likely CORS (network-level failure) and proxy not on -> offer the local proxy.
      if (isNetworkError(e) && !settings.proxyEnabled) {
        showProxy("拉取模型失败，可能是该提供商不支持浏览器直连（CORS）。可安装本地脚本转发后再试。");
      }
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    await upsertProvider({ ...p, name: p.name.trim() || "未命名提供商" });
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "添加提供商" : "编辑提供商"}
      footer={
        <>
          <button className={cn(styles.buttonGhost, styles.press)} onClick={onClose}>取消</button>
          <button className={cn(styles.button, styles.press)} onClick={save} disabled={!p.baseURL.trim()}>保存</button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isNew && (
          <Field label="从预设开始">
            <select className={styles.input} defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="" disabled>选择一个预设…</option>
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{preset.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="名称">
          <input className={styles.input} value={p.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <Field label="接口协议">
          <select className={styles.input} value={p.kind} onChange={(e) => set({ kind: e.target.value as Provider["kind"] })}>
            <option value="openai">OpenAI 兼容</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
        </Field>

        <Field label="Base URL" hint="OpenAI 兼容可不带 /v1，会自动补全">
          <input className={styles.input} value={p.baseURL} onChange={(e) => set({ baseURL: e.target.value })} placeholder="https://..." />
        </Field>

        <Field label="模型" hint={modelMsg ?? undefined}>
          <div className="flex gap-2">
            <input
              className={cn(styles.input, "flex-1")}
              list="pf-models"
              value={p.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder="拉取或手动输入"
            />
            <datalist id="pf-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <button
              className={cn(styles.buttonGhost, styles.press, "shrink-0")}
              onClick={loadModels}
              disabled={loadingModels || !p.apiKey || !p.baseURL}
            >
              {loadingModels ? <Loader2 className="size-4 animate-spin" /> : <ListRestart className="size-4" />}
              拉取
            </button>
          </div>
        </Field>

        <Field label="API Key" hint="仅保存在本地浏览器">
          <div className="relative">
            <input
              className={cn(styles.input, "pr-10 font-mono")}
              type={showKey ? "text" : "password"}
              value={p.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-3" onClick={() => setShowKey((v) => !v)} aria-label="显示/隐藏">
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <details className="rounded-control border border-border-subtle px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-text-2">高级</summary>
          <div className="mt-3">
            <Field label="推理强度" hint="翻译一般用「关」最快最省；复杂文档可调高">
              <select
                className={styles.input}
                value={p.reasoning ?? "off"}
                onChange={(e) => set({ reasoning: e.target.value as ReasoningLevel })}
              >
                {REASONING.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
          </div>
        </details>
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-3">{hint}</span>}
    </label>
  );
}
