import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Database, Pencil, Cpu } from "lucide-react";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db, patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { deleteProvider, listProviders, makeProvider, nextOrder, updateProvider } from "@/features/providers/store";
import { PROVIDER_PRESETS } from "@/features/providers/presets";
import { useProxyDialog } from "@/store/proxyDialog";
import { clearMemory, memoryCount } from "@/features/memory/tm";
import { ProviderForm } from "./ProviderForm";
import type { Provider } from "@/types";

export function SettingsPage() {
  const settings = useSettings();
  const providers = useLiveQuery(listProviders, [], []) ?? [];
  const showProxy = useProxyDialog((s) => s.show);
  const memCount = useLiveQuery(memoryCount, [], 0) ?? 0;
  const [editing, setEditing] = useState<{ provider: Provider; isNew: boolean } | null>(null);

  async function addNew() {
    const order = await nextOrder();
    setEditing({ provider: makeProvider(PROVIDER_PRESETS[0], order), isNew: true });
  }

  async function clearAll() {
    if (!confirm("确定清空全部本地数据（文档、翻译、术语库、设置）？此操作不可撤销。")) return;
    await db.delete();
    location.reload();
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <span className={styles.kicker}>设置</span>
        <h1 className={styles.pageTitle}>AI 提供商与隐私</h1>
        <p className={styles.muted}>像 cc switch 一样配置多个提供商；所有 Key 仅存本地浏览器。</p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className={styles.sectionHeading}>AI 提供商</h2>
          <button className={cn(styles.button, styles.press)} onClick={addNew}>
            <Plus className="size-4" /> 添加
          </button>
        </div>

        {providers.length === 0 ? (
          <div className={cn(styles.card, "p-6 text-center")}>
            <p className={styles.muted}>还没有提供商。点「添加」配置一个；未配置时可用免费 Google 兜底。</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {providers.map((p) => (
              <ProviderRow key={p.id} provider={p} onEdit={() => setEditing({ provider: p, isNew: false })} />
            ))}
          </div>
        )}
        <p className="text-xs text-text-3">
          提示：纯网页只能连支持 CORS 的提供商（OpenAI / Gemini / OpenRouter / Groq / DeepSeek 等）；
          自建网关等无 CORS 的需之后的本地代理。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={styles.sectionHeading}>翻译兜底</h2>
        <label className={cn(styles.card, "flex cursor-pointer items-center justify-between p-4")}>
          <div>
            <div className="font-medium">Google 免费翻译兜底</div>
            <p className={styles.muted}>所有提供商失败时使用（纯浏览器可能受 CORS 限制）。</p>
          </div>
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={settings.googleFallback}
            onChange={(e) => patchSettings({ googleFallback: e.target.checked })}
          />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={styles.sectionHeading}>翻译记忆与术语</h2>
        <label className={cn(styles.card, "flex cursor-pointer items-center justify-between p-4")}>
          <div>
            <div className="font-medium">翻译记忆缓存</div>
            <p className={styles.muted}>相同段落不重复翻译，省费提速。当前缓存 {memCount} 条。</p>
          </div>
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={settings.memoryEnabled}
            onChange={(e) => patchSettings({ memoryEnabled: e.target.checked })}
          />
        </label>
        <label className={cn(styles.card, "flex cursor-pointer items-center justify-between p-4")}>
          <div>
            <div className="font-medium">翻译时自动抽取术语</div>
            <p className={styles.muted}>翻译完成后自动把专有名词存入该文档的术语库。</p>
          </div>
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={settings.autoExtractTerms}
            onChange={(e) => patchSettings({ autoExtractTerms: e.target.checked })}
          />
        </label>
        <div className={cn(styles.card, "flex items-center justify-between p-4")}>
          <div>
            <div className="font-medium">清除翻译记忆</div>
            <p className={styles.muted}>删除缓存的译文（不影响已翻译文档）。</p>
          </div>
          <button
            className={cn(styles.buttonGhost, styles.press)}
            onClick={() => confirm("清除全部翻译记忆缓存？") && clearMemory()}
          >
            <Trash2 className="size-4" /> 清除（{memCount}）
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={styles.sectionHeading}>本地代理</h2>
        <div className={cn(styles.card, "flex items-center justify-between p-4")}>
          <div>
            <div className="font-medium">
              连接无 CORS 的提供商{settings.proxyEnabled ? "（已启用）" : "（未启用）"}
            </div>
            <p className={styles.muted}>用本机小脚本转发请求，让 opencode zen 等自建网关也能用，数据仍在本地。</p>
          </div>
          <button className={cn(styles.buttonGhost, styles.press)} onClick={() => showProxy()}>
            配置 / 查看脚本
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={styles.sectionHeading}>隐私</h2>
        <div className={cn(styles.card, "flex items-center justify-between p-4")}>
          <div>
            <div className="flex items-center gap-2 font-medium">
              <Database className="size-4" /> 清空全部本地数据
            </div>
            <p className={styles.muted}>删除所有文档、翻译与设置，无法恢复。</p>
          </div>
          <button className={cn(styles.buttonGhost, styles.press, "text-red-500")} onClick={clearAll}>
            <Trash2 className="size-4" /> 清空
          </button>
        </div>
      </section>

      {editing && (
        <ProviderForm initial={editing.provider} isNew={editing.isNew} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ProviderRow({ provider, onEdit }: { provider: Provider; onEdit: () => void }) {
  return (
    <div className={cn(styles.card, "flex items-center gap-3 p-3")}>
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
        <Cpu className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{provider.name}</div>
        <div className="truncate font-mono text-xs text-text-3">
          {provider.model || "（未设模型）"}
          {provider.reasoning && provider.reasoning !== "off" ? ` · 推理:${provider.reasoning}` : ""}
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-text-2" title="启用">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={provider.enabled}
          onChange={(e) => updateProvider(provider.id, { enabled: e.target.checked })}
        />
      </label>
      <button className="rounded-control p-2 text-text-3 hover:bg-surface-2 hover:text-text-1" onClick={onEdit} aria-label="编辑">
        <Pencil className="size-4" />
      </button>
      <button
        className="rounded-control p-2 text-text-3 hover:bg-surface-2 hover:text-red-500"
        onClick={() => deleteProvider(provider.id)}
        aria-label="删除"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
