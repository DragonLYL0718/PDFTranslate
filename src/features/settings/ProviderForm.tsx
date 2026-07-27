import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, EyeOff, ListRestart, Loader2 } from "lucide-react";
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

/**
 * Password managers see the text fields sitting above the API key input and
 * offer to autofill them as a login, covering our own dropdown. Opt out with
 * every vendor's ignore hint.
 */
const NO_AUTOFILL = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-protonpass-ignore": "true",
  "data-form-type": "other",
} as const;

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
          <input {...NO_AUTOFILL} className={styles.input} value={p.name} // Typing a name opts the provider out of following the UI language.
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
          <input {...NO_AUTOFILL} className={styles.input} value={p.baseURL} onChange={(e) => set({ baseURL: e.target.value })} placeholder="https://..." />
        </Field>

        <Field label={t("provider.model")} hint={modelMsg ?? undefined}>
          <div className="flex gap-2">
            <ModelPicker
              value={p.model}
              models={models}
              onChange={(model) => set({ model })}
              placeholder={t("provider.modelPlaceholder")}
            />
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

/**
 * Free-text model field with a dropdown of the fetched models. A native
 * <datalist> would be simpler, but its popup loses to password-manager
 * overlays and can't be opened by click in every browser.
 */
function ModelPicker({ value, models, onChange, placeholder }: {
  value: string;
  models: string[];
  onChange: (model: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listBox = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const q = value.trim().toLowerCase();
  const matches = models.filter((m) => m.toLowerCase().includes(q));
  // Typing something unmatched shouldn't blank the list — fall back to all.
  const list = matches.length ? matches : models;
  // The list shrinks as you type, so the highlight can outrun it.
  const idx = Math.min(active, list.length - 1);

  useEffect(() => {
    if (!open) return;
    (listBox.current?.children[idx] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [open, idx]);

  function pick(model: string) {
    onChange(model);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (!open) return;
      e.stopPropagation(); // close the list, not the whole dialog
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      if (!open || !list[idx]) return;
      e.preventDefault();
      pick(list[idx]);
      return;
    }
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !list.length) return;
    e.preventDefault(); // keep the caret put instead of jumping to either end
    if (!open) {
      setOpen(true);
      setActive(0);
      return;
    }
    const step = e.key === "ArrowDown" ? 1 : -1;
    setActive((idx + step + list.length) % list.length);
  }

  return (
    <div className="relative flex-1" ref={box}>
      <input
        {...NO_AUTOFILL}
        className={cn(styles.input, models.length && "pr-9")}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls="pf-models"
        aria-activedescendant={open && list[idx] ? `pf-model-${idx}` : undefined}
      />
      {models.length > 0 && (
        <>
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-3"
            onClick={() => setOpen((v) => !v)}
            aria-label={placeholder}
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ul
              id="pf-models"
              ref={listBox}
              role="listbox"
              className={cn(styles.card, "absolute z-10 mt-1 max-h-56 w-full overflow-y-auto py-1 pretty-scrollbar")}
            >
              {list.map((m, i) => (
                <li
                  key={m}
                  id={`pf-model-${i}`}
                  role="option"
                  aria-selected={m === value}
                  className={cn(
                    "cursor-pointer truncate px-3 py-1.5 text-sm",
                    i === idx && "bg-surface-2",
                    m === value ? "text-accent" : "text-text-1",
                  )}
                  // mousedown + preventDefault: the wrapping <label> would
                  // otherwise bounce the click back to the input.
                  onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                  onMouseEnter={() => setActive(i)}
                >
                  {m}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
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
