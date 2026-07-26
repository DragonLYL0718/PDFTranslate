import { useState } from "react";
import { Eye, EyeOff, ListRestart, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { t, type PlainKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { PROVIDER_PRESETS, presetName } from "@/features/providers/presets";
import { fetchModels } from "@/features/providers/models";
import { providerLabel, upsertProvider } from "@/features/providers/store";
import { isNetworkError } from "@/features/providers/net";
import { useProxyDialog } from "@/store/proxyDialog";
import { useSettings } from "@/store/useSettings";
import type { Provider, ReasoningLevel } from "@/types";

const REASONING: { value: ReasoningLevel; labelKey: PlainKey }[] = [
  { value: "off", labelKey: "provider.reasoningOff" },
  { value: "low", labelKey: "provider.reasoningLow" },
  { value: "medium", labelKey: "provider.reasoningMedium" },
  { value: "high", labelKey: "provider.reasoningHigh" },
];

interface Props {
  initial: Provider;
  isNew: boolean;
  onClose: () => void;
}

export function ProviderForm({ initial, isNew, onClose }: Props) {
  const settings = useSettings();
  const showProxy = useProxyDialog((s) => s.show);
  const [p, setP] = useState<Provider>({ ...initial, name: providerLabel(initial) });
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelMsg, setModelMsg] = useState<string | null>(null);

  const set = (patch: Partial<Provider>) => setP((prev) => ({ ...prev, ...patch }));

  function applyPreset(key: string) {
    const preset = PROVIDER_PRESETS.find((x) => x.key === key);
    if (preset) set({ name: presetName(preset), nameKey: preset.nameKey, kind: preset.kind, baseURL: preset.baseURL, model: preset.model });
  }

  async function loadModels() {
    setLoadingModels(true);
    setModelMsg(null);
    try {
      const list = await fetchModels(p);
      setModels(list);
      setModelMsg(list.length ? t("provider.fetched", { count: list.length }) : t("provider.noModels"));
    } catch (e) {
      setModelMsg(e instanceof Error ? t("provider.fetchFailedHint", { error: e.message }) : t("provider.fetchFailed"));
      // Likely CORS (network-level failure) and proxy not on -> offer the local proxy.
      if (isNetworkError(e) && !settings.proxyEnabled) {
        showProxy(t("provider.fetchCorsPrompt"));
      }
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    // Stored as text in the locale that was active when it was created; the name is user-editable.
    const name = p.name.trim();
    await upsertProvider(
      name ? { ...p, name } : { ...p, name: t("provider.untitled"), nameKey: "provider.untitled" },
    );
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t("provider.addTitle") : t("provider.editTitle")}
      footer={
        <>
          <button className={cn(styles.buttonGhost, styles.press)} onClick={onClose}>{t("common.cancel")}</button>
          <button className={cn(styles.button, styles.press)} onClick={save} disabled={!p.baseURL.trim()}>{t("common.save")}</button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isNew && (
          <Field label={t("provider.preset")}>
            <select className={styles.input} defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="" disabled>{t("provider.presetPlaceholder")}</option>
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{presetName(preset)}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t("provider.name")}>
          <input className={styles.input} value={p.name} // Typing a name opts the provider out of following the UI language.
            onChange={(e) => set({ name: e.target.value, nameKey: undefined })} />
        </Field>

        <Field label={t("provider.kind")}>
          <select className={styles.input} value={p.kind} onChange={(e) => set({ kind: e.target.value as Provider["kind"] })}>
            <option value="openai">{t("provider.kindOpenai")}</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
        </Field>

        <Field label="Base URL" hint={t("provider.baseUrlHint")}>
          <input className={styles.input} value={p.baseURL} onChange={(e) => set({ baseURL: e.target.value })} placeholder="https://..." />
        </Field>

        <Field label={t("provider.model")} hint={modelMsg ?? undefined}>
          <div className="flex gap-2">
            <input
              className={cn(styles.input, "flex-1")}
              list="pf-models"
              value={p.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder={t("provider.modelPlaceholder")}
            />
            <datalist id="pf-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <button
              className={cn(styles.buttonGhost, styles.press, "shrink-0")}
              onClick={loadModels}
              disabled={loadingModels || !p.apiKey || !p.baseURL}
            >
              {loadingModels ? <Loader2 className="size-4 animate-spin" /> : <ListRestart className="size-4" />}
              {t("provider.fetch")}
            </button>
          </div>
        </Field>

        <Field label="API Key" hint={t("provider.apiKeyHint")}>
          <div className="relative">
            <input
              className={cn(styles.input, "pr-10 font-mono")}
              type={showKey ? "text" : "password"}
              value={p.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-3" onClick={() => setShowKey((v) => !v)} aria-label={t("provider.toggleKey")}>
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <details className="rounded-control border border-border-subtle px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-text-2">{t("provider.advanced")}</summary>
          <div className="mt-3">
            <Field label={t("provider.reasoning")} hint={t("provider.reasoningHint")}>
              <select
                className={styles.input}
                value={p.reasoning ?? "off"}
                onChange={(e) => set({ reasoning: e.target.value as ReasoningLevel })}
              >
                {REASONING.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
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
