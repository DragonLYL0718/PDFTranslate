import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Database, Pencil, Cpu } from "lucide-react";
import { t, type PlainKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db, patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { deleteProvider, listProviders, makeProvider, nextOrder, providerLabel, updateProvider } from "@/features/providers/store";
import { PROVIDER_PRESETS } from "@/features/providers/presets";
import { useProxyDialog } from "@/store/proxyDialog";
import { clearMemory, memoryCount } from "@/features/memory/tm";
import { LanguageSection } from "./LanguageSection";
import { ProviderForm } from "./ProviderForm";
import type { Provider, TermStrictness } from "@/types";

// Message keys, not text: this array is built before initI18n() picks a locale.
const STRICTNESS_OPTIONS: { value: TermStrictness; labelKey: PlainKey }[] = [
  { value: "loose", labelKey: "settings.strictness.loose" },
  { value: "standard", labelKey: "settings.strictness.standard" },
  { value: "strict", labelKey: "settings.strictness.strict" },
];

const STRICTNESS_HINT: Record<TermStrictness, PlainKey> = {
  loose: "settings.strictness.looseHint",
  standard: "settings.strictness.standardHint",
  strict: "settings.strictness.strictHint",
};

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
    if (!confirm(t("settings.privacy.clearAllConfirm"))) return;
    await db.delete();
    location.reload();
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <span className={styles.kicker}>{t("settings.kicker")}</span>
        <h1 className={styles.pageTitle}>{t("settings.title")}</h1>
      </header>

      <LanguageSection />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className={styles.sectionHeading}>{t("settings.providers.title")}</h2>
          <button className={cn(styles.button, styles.press)} onClick={addNew}>
            <Plus className="size-4" /> {t("common.add")}
          </button>
        </div>

        {providers.length === 0 ? (
          <div className={cn(styles.card, "p-6 text-center")}>
            <p className={styles.muted}>{t("settings.providers.empty")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {providers.map((p) => (
              <ProviderRow key={p.id} provider={p} onEdit={() => setEditing({ provider: p, isNew: false })} />
            ))}
          </div>
        )}
        <p className="text-xs text-text-3">{t("settings.providers.corsHint")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={styles.sectionHeading}>{t("settings.fallback.title")}</h2>
        <label className={cn(styles.card, "flex cursor-pointer items-center justify-between p-4")}>
          <div>
            <div className="font-medium">{t("settings.fallback.google")}</div>
            <p className={styles.muted}>{t("settings.fallback.googleDesc")}</p>
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
        <h2 className={styles.sectionHeading}>{t("settings.memory.title")}</h2>
        <label className={cn(styles.card, "flex cursor-pointer items-center justify-between p-4")}>
          <div>
            <div className="font-medium">{t("settings.memory.cache")}</div>
            <p className={styles.muted}>{t("settings.memory.cacheDesc", { count: memCount })}</p>
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
            <div className="font-medium">{t("settings.terms.auto")}</div>
            <p className={styles.muted}>{t("settings.terms.autoDesc")}</p>
          </div>
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={settings.autoExtractTerms}
            onChange={(e) => patchSettings({ autoExtractTerms: e.target.checked })}
          />
        </label>
        {settings.autoExtractTerms && (
          <div className={cn(styles.card, "flex flex-col gap-3 p-4")}>
            <div>
              <div className="font-medium">{t("settings.strictness.title")}</div>
              <p className={styles.muted}>{t(STRICTNESS_HINT[settings.termStrictness])}</p>
            </div>
            <div className="flex gap-2 rounded-control border border-border-subtle p-1">
              {STRICTNESS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => patchSettings({ termStrictness: o.value })}
                  className={cn(
                    "flex-1 rounded px-3 py-1.5 text-sm transition-colors",
                    settings.termStrictness === o.value ? "bg-accent text-white" : "hover:bg-surface-2",
                  )}
                >
                  {t(o.labelKey)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className={cn(styles.card, "flex items-center justify-between p-4")}>
          <div>
            <div className="font-medium">{t("settings.memory.clear")}</div>
            <p className={styles.muted}>{t("settings.memory.clearDesc")}</p>
          </div>
          <button
            className={cn(styles.buttonGhost, styles.press)}
            onClick={() => confirm(t("settings.memory.clearConfirm")) && clearMemory()}
          >
            <Trash2 className="size-4" /> {t("settings.memory.clearBtn", { count: memCount })}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={styles.sectionHeading}>{t("settings.proxy.title")}</h2>
        <div className={cn(styles.card, "flex items-center justify-between p-4")}>
          <div>
            <div className="font-medium">
              {settings.proxyEnabled ? t("settings.proxy.enabled") : t("settings.proxy.disabled")}
            </div>
            <p className={styles.muted}>{t("settings.proxy.desc")}</p>
          </div>
          <button className={cn(styles.buttonGhost, styles.press)} onClick={() => showProxy()}>
            {t("settings.proxy.button")}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={styles.sectionHeading}>{t("settings.privacy.title")}</h2>
        <div className={cn(styles.card, "flex items-center justify-between p-4")}>
          <div>
            <div className="flex items-center gap-2 font-medium">
              <Database className="size-4" /> {t("settings.privacy.clearAll")}
            </div>
            <p className={styles.muted}>{t("settings.privacy.clearAllDesc")}</p>
          </div>
          <button className={cn(styles.buttonGhost, styles.press, "text-red-500")} onClick={clearAll}>
            <Trash2 className="size-4" /> {t("common.clear")}
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
        <div className="truncate text-sm font-medium">{providerLabel(provider)}</div>
        <div className="truncate font-mono text-xs text-text-3">
          {provider.model || t("provider.noModel")}
          {provider.reasoning && provider.reasoning !== "off"
            ? ` · ${t("provider.reasoningTag", { level: provider.reasoning })}`
            : ""}
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-text-2" title={t("common.enable")}>
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={provider.enabled}
          onChange={(e) => updateProvider(provider.id, { enabled: e.target.checked })}
        />
      </label>
      <button className="rounded-control p-2 text-text-3 hover:bg-surface-2 hover:text-text-1" onClick={onEdit} aria-label={t("common.edit")}>
        <Pencil className="size-4" />
      </button>
      <button
        className="rounded-control p-2 text-text-3 hover:bg-surface-2 hover:text-red-500"
        onClick={() => deleteProvider(provider.id)}
        aria-label={t("common.delete")}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
