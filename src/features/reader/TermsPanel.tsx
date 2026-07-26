import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X, RefreshCw, Trash2, Loader2, Plus, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import {
  addTerm,
  adoptTerms,
  createGlossary,
  deleteTerm,
  resolveTermTarget,
  updateTerm,
  glossaryName,
} from "@/features/glossary/store";
import { reextractTerms } from "@/features/glossary/extract";
import { regenerateForTerm } from "@/features/engine/regenerate";
import type { Term } from "@/types";

const NEW_GLOSSARY = "__new__";

interface Props {
  docId: string;
  docName: string;
  onClose: () => void;
}

/** Reader side panel: the document's auto-extracted terms, editable, with per-term region regeneration. */
export function TermsPanel({ docId, docName, onClose }: Props) {
  const settings = useSettings();
  const doc = useLiveQuery(() => db.documents.get(docId), [docId]);
  const all = useLiveQuery(() => db.glossaries.orderBy("createdAt").toArray(), [], []) ?? [];
  // Shared libraries, plus this document's own auto glossary — another
  // document's auto glossary is not a sensible place to file these terms.
  const glossaries = all.filter((g) => g.kind === "manual" || g.docId === docId);
  // Where this document files its terms. Unresolved until the first extraction,
  // so fall back to whatever auto glossary already exists for it.
  const glossaryId = doc?.glossaryId ?? all.find((g) => g.docId === docId)?.id ?? null;
  const terms =
    useLiveQuery(
      () => (glossaryId ? db.terms.where("glossaryId").equals(glossaryId).toArray() : Promise.resolve<Term[]>([])),
      [glossaryId],
    ) ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ source: "", target: "" });

  async function regenerate(termSource: string) {
    setBusy(termSource);
    try {
      await regenerateForTerm(docId, termSource, {
        providerId: settings.lastOptions.providerId,
        googleFallback: settings.googleFallback,
        memoryEnabled: settings.memoryEnabled,
        autoExtract: false,
      });
    } finally {
      setBusy(null);
    }
  }

  async function addManual() {
    await addTerm(await resolveTermTarget(docId, docName), draft);
    setDraft({ source: "", target: "" });
  }

  /** Re-file every term shown here into another library, and go there from now on. */
  async function moveTo(choice: string) {
    const targetId = choice === NEW_GLOSSARY ? await createGlossary(docName.replace(/\.pdf$/i, "")) : choice;
    if (targetId === glossaryId) return;
    await adoptTerms(
      docId,
      glossaryId,
      terms.map((t) => ({ source: t.source, target: t.target })),
      targetId,
    );
  }

  async function extract() {
    setExtracting(true);
    setError(null);
    try {
      const n = await reextractTerms(docId, settings.lastOptions.providerId, settings.googleFallback);
      if (!n) setError(t("terms.extractEmpty"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border-subtle bg-surface-1">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="font-semibold tracking-tight">{t("terms.title")}</div>
        <button onClick={onClose} className="rounded-control p-1 text-text-3 hover:bg-surface-2" aria-label={t("common.close")}>
          <X className="size-4" />
        </button>
      </div>

      {/* Which library this document's terms live in */}
      <div className="flex flex-col gap-1 border-b border-border-subtle px-4 py-3">
        <label className="text-xs font-medium text-text-2">{t("terms.target")}</label>
        <select
          className={styles.input}
          value={glossaryId ?? ""}
          onChange={(e) => moveTo(e.target.value)}
        >
          {!glossaryId && <option value="">{t("terms.none")}</option>}
          {glossaries.map((g) => (
            <option key={g.id} value={g.id}>
              {glossaryName(g)}
              {g.id === settings.defaultGlossaryId ? t("terms.defaultSuffix") : ""}
            </option>
          ))}
          <option value={NEW_GLOSSARY}>{t("terms.newGlossary")}</option>
        </select>
        <p className="text-xs text-text-3">
          {t("terms.moveHint")}
        </p>
      </div>

      <div className="flex items-center gap-2 px-4 py-2">
        <p className="flex-1 text-xs text-text-3">
          {t("terms.regenHint")}
        </p>
        <button
          className={cn(styles.buttonGhost, styles.press, "shrink-0 px-2 py-1 text-xs")}
          onClick={extract}
          disabled={extracting || doc?.status === "translating"}
          title={t("terms.extractTitle")}
        >
          {extracting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {t("terms.extract")}
        </button>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-red-500">{error}</p>}

      <div className="flex gap-2 px-4 pb-2">
        <input className={cn(styles.input, "flex-1")} placeholder={t("terms.sourcePlaceholder")} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
        <input className={cn(styles.input, "flex-1")} placeholder={t("terms.targetPlaceholder")} value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
        <button className={cn(styles.button, styles.press, "shrink-0 px-2")} disabled={!draft.source.trim()} onClick={addManual} aria-label={t("terms.add")}>
          <Plus className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pretty-scrollbar">
        {terms?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-text-3">{t("terms.empty")}</p>
        )}
        {terms?.map((term) => (
          <div key={term.id} className="flex flex-col gap-1.5 border-b border-border-subtle px-4 py-3">
            <div className="font-mono text-xs text-text-3">{term.source}</div>
            <div className="flex items-center gap-1.5">
              <input
                className={cn(styles.input, "flex-1 py-1.5")}
                defaultValue={term.target}
                onBlur={(e) => e.target.value !== term.target && updateTerm(term.id, { target: e.target.value })}
              />
              <button
                className="rounded-control p-1.5 text-text-3 hover:bg-surface-2 hover:text-accent disabled:opacity-50"
                onClick={() => regenerate(term.source)}
                disabled={busy !== null}
                title={t("terms.regenTitle")}
              >
                {busy === term.source ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </button>
              <button
                className="rounded-control p-1.5 text-text-3 hover:bg-surface-2 hover:text-red-500"
                onClick={() => deleteTerm(term.id)}
                aria-label={t("terms.delete")}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Link to="/glossary" className="border-t border-border-subtle px-4 py-3 text-sm text-accent hover:underline">
        {t("terms.manageAll")}
      </Link>
    </aside>
  );
}
