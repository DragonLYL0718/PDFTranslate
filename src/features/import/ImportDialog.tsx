import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, Sparkles, Calculator, Cpu, Wrench } from "lucide-react";
import { Modal } from "@/components/Modal";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { useBabelDocDialog } from "@/store/babeldocDialog";
import { db } from "@/db/db";
import { listProviders, providerLabel } from "@/features/providers/store";
import { createGlossary, glossaryName } from "@/features/glossary/store";
import { estimateCost } from "@/features/engine/costEstimate";
import {
  getEngineBStatus,
  probeEngineB,
  resetEngineBProbe,
  type EngineBOptions,
  type EngineBStatus,
} from "@/features/engine/engineB";
import { LANGUAGES, langName } from "./languages";
import { parsePageRange } from "./pageRange";
import { createDoc, probePdf } from "./createDoc";
import type { JobOptions } from "@/features/engine/runJob";

export interface PendingImport {
  name: string;
  size: number;
  data: ArrayBuffer;
}

/** Value of the glossary <select> that keeps terms in a per-document glossary. */
const PER_DOC = "__per_doc__";
const NEW_GLOSSARY = "__new__";

interface Props {
  pending: PendingImport | null;
  onClose: () => void;
  onStart: (docId: string, job: JobOptions) => void;
  onStartEngineB: (docId: string, opts: EngineBOptions) => void;
}

export function ImportDialog({ pending, onClose, onStart, onStartEngineB }: Props) {
  const settings = useSettings();
  const providers = useLiveQuery(listProviders, [], []) ?? [];
  const manualGlossaries =
    useLiveQuery(() => db.glossaries.where("kind").equals("manual").sortBy("createdAt"), [], []) ?? [];
  const usable = providers.filter((p) => p.enabled && p.apiKey);
  // BabelDOC only speaks the OpenAI protocol, so engine B is limited to these.
  const openaiUsable = usable.filter((p) => p.kind === "openai");
  const { show: showBabelDocSetup, open: setupOpen } = useBabelDocDialog();

  const [engineB, setEngineB] = useState<EngineBStatus>(getEngineBStatus);
  const [probe, setProbe] = useState<{ pageCount: number; detected: string } | null>(null);
  const [range, setRange] = useState("");
  const [source, setSource] = useState(settings.lastOptions.sourceLang);
  const [target, setTarget] = useState(settings.lastOptions.targetLang);
  const [providerId, setProviderId] = useState<string | null>(settings.lastOptions.providerId);
  const [glossaryChoice, setGlossaryChoice] = useState(PER_DOC);
  const [useEngineB, setUseEngineB] = useState(false);
  const [busy, setBusy] = useState(false);

  // Probe the backend and reflect the result; auto-select engine B if it's
  // available and the user's last choice was BabelDOC.
  function refreshEngineB(fresh = false) {
    if (fresh) resetEngineBProbe();
    probeEngineB().then((st) => {
      setEngineB(st);
      if (st.available && settings.lastOptions.engine === "babeldoc") setUseEngineB(true);
    });
  }

  useEffect(() => {
    if (!pending) return;
    setProbe(null);
    setRange("");
    setSource(settings.lastOptions.sourceLang);
    setTarget(settings.lastOptions.targetLang);
    setProviderId(settings.lastOptions.providerId);
    setGlossaryChoice(settings.defaultGlossaryId ?? PER_DOC);
    setUseEngineB(false);
    // Freshly probe each time the dialog opens so a just-started backend is
    // detected (the cached status may be stale from app startup).
    refreshEngineB(true);
    probePdf(pending.data.slice(0)).then(setProbe).catch(() => setProbe({ pageCount: 0, detected: "auto" }));
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-probe when the "install BabelDOC" dialog closes — the user may have just
  // connected the backend there, so refresh the engine selector state.
  useEffect(() => {
    if (setupOpen || !pending) return;
    refreshEngineB();
  }, [setupOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeError = useMemo(() => {
    if (!probe || !range.trim()) return null;
    const parsed = parsePageRange(range, probe.pageCount);
    // null = blank/"all" (fine); [] = non-blank input that matched no valid page.
    return parsed && parsed.length === 0 ? t("import.rangeInvalid") : null;
  }, [range, probe]);

  const pages = useMemo(() => {
    if (!probe) return [];
    return parsePageRange(range, probe.pageCount) ?? Array.from({ length: probe.pageCount }, (_, i) => i + 1);
  }, [probe, range]);

  const cost = useMemo(() => {
    if (!probe || rangeError || useEngineB) return null;
    return estimateCost(pages, 3000, usable);
  }, [probe, pages, rangeError, useEngineB, usable]);

  async function start() {
    if (!pending || !probe) return;
    setBusy(true);
    try {
      const selectedPages = parsePageRange(range, probe.pageCount);
      // null pins terms to a per-document glossary; an id files them in a
      // shared library. Resolved here so the choice survives a later re-translate.
      const glossaryId =
        glossaryChoice === PER_DOC
          ? null
          : glossaryChoice === NEW_GLOSSARY
            ? await createGlossary(pending.name.replace(/\.pdf$/i, ""))
            : glossaryChoice;
      const docId = await createDoc({
        name: pending.name,
        size: pending.size,
        data: pending.data,
        pageCount: probe.pageCount,
        selectedPages,
        sourceLang: source,
        detectedLang: probe.detected,
        targetLang: target,
        engine: useEngineB ? "babeldoc" : "heuristic",
        glossaryId,
      });
      await patchSettings({
        lastOptions: { ...settings.lastOptions, sourceLang: source, targetLang: target, providerId },
      });
      if (useEngineB) {
        onStartEngineB(docId, {
          source,
          target,
          providerId,
          autoExtract: settings.autoExtractTerms,
        });
      } else {
        onStart(docId, {
          providerId,
          googleFallback: settings.googleFallback,
          memoryEnabled: settings.memoryEnabled,
          autoExtract: settings.autoExtractTerms,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!pending}
      onClose={onClose}
      title={t("import.title")}
      footer={
        <>
          <button className={cn(styles.buttonGhost, styles.press)} onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button className={cn(styles.button, styles.press)} onClick={start} disabled={busy || !probe || !!rangeError}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t("import.start")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="truncate text-sm font-medium">{pending?.name}</div>

        {!probe ? (
          <div className="flex items-center gap-2 text-sm text-text-3">
            <Loader2 className="size-4 animate-spin" /> {t("import.parsing")}
          </div>
        ) : (
          <>
            <Field
              label={t("import.pageRange", { count: probe.pageCount })}
              hint={rangeError ?? t("import.pageRangeHint")}
            >
              <input
                className={cn(styles.input, rangeError && "border-red-500")}
                value={range}
                onChange={(e) => setRange(e.target.value)}
                placeholder={t("import.pageRangePlaceholder")}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t("import.sourceLang")}
                hint={source === "auto" ? t("import.detectedAs", { name: langName(probe.detected) }) : undefined}
              >
                <Select value={source} onChange={setSource} extra={{ value: "auto", label: langName("auto") }} />
              </Field>
              <Field label={t("import.targetLang")}>
                <Select value={target} onChange={setTarget} />
              </Field>
            </div>

            {/* Engine selector */}
            <div className="flex gap-2 rounded-control border border-border-subtle p-1">
              <button
                onClick={() => setUseEngineB(false)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors",
                  !useEngineB ? "bg-accent text-white" : "hover:bg-surface-2",
                )}
              >
                <Cpu className="size-4" /> {t("import.engineA")}
              </button>
              <button
                onClick={() => {
                  if (!engineB.available) { showBabelDocSetup(); return; }
                  setUseEngineB(true);
                  // Ensure a concrete OpenAI provider is selected for BabelDOC.
                  if (!openaiUsable.some((p) => p.id === providerId)) {
                    setProviderId(openaiUsable[0]?.id ?? null);
                  }
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors",
                  useEngineB ? "bg-accent text-white" : "hover:bg-surface-2",
                )}
              >
                {engineB.available ? (
                  <>{t("import.engineBReady")}</>
                ) : (
                  <><Wrench className="size-3.5" /> {t("import.engineBInstall")}</>
                )}
              </button>
            </div>

            {/* Provider selector */}
            <Field
              label={t("import.provider")}
              hint={useEngineB ? t("import.providerBabeldocHint") : undefined}
            >
              <select
                className={styles.input}
                value={providerId ?? ""}
                onChange={(e) => setProviderId(e.target.value || null)}
              >
                {!useEngineB && <option value="">{t("import.providerAuto")}</option>}
                {(useEngineB ? openaiUsable : usable).map((p) => (
                  <option key={p.id} value={p.id}>
                    {providerLabel(p)} · {p.model}
                  </option>
                ))}
              </select>
            </Field>

            {/* Where auto-extracted terms are filed */}
            {settings.autoExtractTerms && (
              <Field
                label={t("import.glossaryTarget")}
                hint={
                  glossaryChoice === PER_DOC
                    ? t("import.glossaryPerDocHint")
                    : t("import.glossarySharedHint")
                }
              >
                <select
                  className={styles.input}
                  value={glossaryChoice}
                  onChange={(e) => setGlossaryChoice(e.target.value)}
                >
                  <option value={PER_DOC}>{t("import.glossaryPerDoc")}</option>
                  {manualGlossaries.map((g) => (
                    <option key={g.id} value={g.id}>
                      {glossaryName(g)}
                      {g.id === settings.defaultGlossaryId ? t("terms.defaultSuffix") : ""}
                    </option>
                  ))}
                  <option value={NEW_GLOSSARY}>{t("terms.newGlossary")}</option>
                </select>
              </Field>
            )}

            {useEngineB && openaiUsable.length === 0 && (
              <p className="text-xs text-red-500">
                {t("import.needOpenAI")}
              </p>
            )}
            {!useEngineB && usable.length === 0 && (
              <p className="text-xs text-text-3">
                {settings.googleFallback ? t("import.noProviderGoogle") : t("import.noProviderNone")}
              </p>
            )}
          </>
        )}
      </div>

      {cost && (
        <details className="mt-2 rounded-control border border-border-subtle px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-text-2">
            <Calculator className="mr-1 inline size-3" />
            {t("import.costSummary", {
              pages: cost.totalPages,
              chars: (cost.totalChars / 1000).toFixed(0),
            })}
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            {cost.providers
              .filter((p) => !(p.free && !usable.find((u) => u.model === p.model)))
              .map((p) => (
                <div key={p.model} className="flex justify-between text-xs">
                  <span className="text-text-2">{p.name}</span>
                  <span className="font-mono text-text-3">{p.free ? t("common.free") : `${p.costMin} – ${p.costMax}`}</span>
                </div>
              ))}
          </div>
        </details>
      )}
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

function Select({
  value,
  onChange,
  extra,
}: {
  value: string;
  onChange: (v: string) => void;
  extra?: { value: string; label: string };
}) {
  return (
    <select className={styles.input} value={value} onChange={(e) => onChange(e.target.value)}>
      {extra && <option value={extra.value}>{extra.label}</option>}
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {langName(l.code)}
        </option>
      ))}
    </select>
  );
}
