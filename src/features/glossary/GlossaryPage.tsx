import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Upload, Download, BookMarked, Star, Filter } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { Modal } from "@/components/Modal";
import { db } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import {
  addTerm,
  createDefaultGlossary,
  deleteGlossary,
  deleteTerm,
  glossaryName,
  importTerms,
  parseCsv,
  renameGlossary,
  setDefaultGlossary,
  termsToCsv,
  updateTerm,
} from "./store";
import { PruneDialog } from "./PruneDialog";
import type { Term } from "@/types";

export function GlossaryPage() {
  const settings = useSettings();
  const [dialog, setDialog] = useState<"prune" | "delete" | null>(null);
  const glossaries = useLiveQuery(() => db.glossaries.orderBy("createdAt").toArray(), [], []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = glossaries?.find((g) => g.id === selectedId) ?? glossaries?.[0] ?? null;
  const terms =
    useLiveQuery(
      () => (current ? db.terms.where("glossaryId").equals(current.id).toArray() : Promise.resolve<Term[]>([])),
      [current?.id],
    ) ?? [];
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ source: "", target: "" });

  async function onImport(file: File) {
    const text = await file.text();
    let pairs: { source: string; target: string; note?: string }[];
    if (file.name.toLowerCase().endsWith(".json")) {
      const data = JSON.parse(text);
      pairs = (Array.isArray(data) ? data : []).map((d) => ({
        source: d.source ?? d.s ?? "",
        target: d.target ?? d.t ?? d.d ?? "",
        note: d.note,
      }));
    } else {
      pairs = parseCsv(text);
    }
    if (current) await importTerms(current.id, pairs);
  }

  function exportCsv() {
    if (!current || !terms) return;
    const blob = new Blob([termsToCsv(terms)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${glossaryName(current)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className={styles.kicker}>{t("glossary.kicker")}</span>
        <h1 className={styles.pageTitle}>{t("glossary.title")}</h1>
        <p className={styles.muted}>{t("glossary.subtitle")}</p>
      </header>

      {/* Glossary chips */}
      <div className="flex flex-wrap items-center gap-2">
        {glossaries?.map((g) => (
          <button
            key={g.id}
            onClick={() => setSelectedId(g.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              current?.id === g.id
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-subtle text-text-2 hover:bg-surface-2",
            )}
          >
            {g.id === settings.defaultGlossaryId ? (
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
            ) : (
              <BookMarked className="size-3.5" />
            )}
            {glossaryName(g)}
            {g.kind === "auto" && <span className="text-xs text-text-3">{t("glossary.auto")}</span>}
          </button>
        ))}
        <button
          className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-sm")}
          onClick={async () => setSelectedId(await createDefaultGlossary())}
        >
          <Plus className="size-4" /> {t("glossary.new")}
        </button>
      </div>

      {current && (
        <div className={cn(styles.card, "flex flex-col")}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle p-3">
            <input
              className={cn(styles.input, "max-w-56 flex-1 font-medium")}
              value={glossaryName(current)}
              onChange={(e) => renameGlossary(current.id, e.target.value)}
            />
            <span className="text-xs text-text-3">{t("glossary.count", { count: terms?.length ?? 0 })}</span>
            <div className="ml-auto flex gap-2">
              <button
                className={cn(
                  styles.buttonGhost,
                  styles.press,
                  "px-3 py-1.5 text-xs",
                  current.id === settings.defaultGlossaryId && "border-amber-400 text-amber-500",
                )}
                onClick={() =>
                  setDefaultGlossary(current.id === settings.defaultGlossaryId ? null : current.id)
                }
                title={t("glossary.setDefaultTitle")}
              >
                <Star
                  className={cn("size-3.5", current.id === settings.defaultGlossaryId && "fill-amber-400")}
                />
                {current.id === settings.defaultGlossaryId ? t("glossary.isDefault") : t("glossary.setDefault")}
              </button>
              <button
                className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")}
                onClick={() => setDialog("prune")}
                title={t("glossary.pruneTitle")}
              >
                <Filter className="size-3.5" /> {t("glossary.prune")}
              </button>
              <button className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")} onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" /> {t("glossary.import")}
              </button>
              <button className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")} onClick={exportCsv}>
                <Download className="size-3.5" /> {t("glossary.export")}
              </button>
              <button
                className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs text-red-500")}
                onClick={() => setDialog("delete")}
              >
                <Trash2 className="size-3.5" /> {t("glossary.deleteGlossary")}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
              />
            </div>
          </div>

          {/* Add row */}
          <div className="flex gap-2 border-b border-border-subtle p-3">
            <input className={styles.input} placeholder={t("glossary.sourcePlaceholder")} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
            <input className={styles.input} placeholder={t("glossary.targetPlaceholder")} value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
            <button
              className={cn(styles.button, styles.press, "shrink-0")}
              disabled={!draft.source.trim()}
              onClick={async () => {
                await addTerm(current.id, draft);
                setDraft({ source: "", target: "" });
              }}
            >
              <Plus className="size-4" /> {t("common.add")}
            </button>
          </div>

          {/* Terms */}
          <div className="flex flex-col divide-y divide-border-subtle">
            {terms?.length === 0 && <p className="p-6 text-center text-sm text-text-3">{t("glossary.empty")}</p>}
            {terms?.map((t) => (
              <TermRow key={t.id} term={t} />
            ))}
          </div>
        </div>
      )}

      {current && dialog === "prune" && (
        <PruneDialog glossary={current} onClose={() => setDialog(null)} />
      )}
      {current && dialog === "delete" && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title={t("glossary.deleteTitle", { name: glossaryName(current) })}
          footer={
            <>
              <button className={cn(styles.buttonGhost, styles.press)} onClick={() => setDialog(null)}>
                {t("common.cancel")}
              </button>
              <button
                className={cn(styles.button, styles.press, "bg-red-500 hover:bg-red-600")}
                onClick={async () => {
                  await deleteGlossary(current.id);
                  setSelectedId(null);
                  setDialog(null);
                }}
              >
                <Trash2 className="size-4" /> {t("common.delete")}
              </button>
            </>
          }
        >
          <p className="text-sm text-text-2">
            {t("glossary.deleteBody", { count: terms?.length ?? 0 })}
          </p>
        </Modal>
      )}
    </div>
  );
}

function TermRow({ term }: { term: Term }) {
  return (
    <div className="flex items-center gap-2 p-2">
      <input
        className={cn(styles.input, "flex-1")}
        defaultValue={term.source}
        onBlur={(e) => e.target.value !== term.source && updateTerm(term.id, { source: e.target.value })}
      />
      <span className="text-text-3">→</span>
      <input
        className={cn(styles.input, "flex-1")}
        defaultValue={term.target}
        onBlur={(e) => e.target.value !== term.target && updateTerm(term.id, { target: e.target.value })}
      />
      {term.origin === "auto" && <span className={cn(styles.chip, "shrink-0")}>{t("glossary.auto")}</span>}
      <button
        className="shrink-0 rounded-control p-2 text-text-3 hover:bg-surface-2 hover:text-red-500"
        onClick={() => deleteTerm(term.id)}
        aria-label={t("terms.delete")}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
