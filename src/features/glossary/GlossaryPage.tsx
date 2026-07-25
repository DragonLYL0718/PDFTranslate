import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Upload, Download, BookMarked } from "lucide-react";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db } from "@/db/db";
import {
  addTerm,
  createGlossary,
  deleteGlossary,
  deleteTerm,
  importTerms,
  parseCsv,
  renameGlossary,
  termsToCsv,
  updateTerm,
} from "./store";
import type { Term } from "@/types";

export function GlossaryPage() {
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
    a.download = `${current.name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className={styles.kicker}>术语库</span>
        <h1 className={styles.pageTitle}>专有名词</h1>
        <p className={styles.muted}>维护术语对照，保证翻译一致。翻译时会注入这些术语，并自动抽取新术语入库。</p>
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
            <BookMarked className="size-3.5" />
            {g.name}
            {g.kind === "auto" && <span className="text-xs text-text-3">自动</span>}
          </button>
        ))}
        <button
          className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-sm")}
          onClick={async () => setSelectedId(await createGlossary("新术语库"))}
        >
          <Plus className="size-4" /> 新建
        </button>
      </div>

      {current && (
        <div className={cn(styles.card, "flex flex-col")}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle p-3">
            <input
              className={cn(styles.input, "max-w-56 flex-1 font-medium")}
              value={current.name}
              onChange={(e) => renameGlossary(current.id, e.target.value)}
            />
            <span className="text-xs text-text-3">{terms?.length ?? 0} 条</span>
            <div className="ml-auto flex gap-2">
              <button className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")} onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" /> 导入
              </button>
              <button className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")} onClick={exportCsv}>
                <Download className="size-3.5" /> 导出
              </button>
              <button
                className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs text-red-500")}
                onClick={() => confirm(`删除术语库「${current.name}」？`) && deleteGlossary(current.id)}
              >
                <Trash2 className="size-3.5" /> 删除库
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
            <input className={styles.input} placeholder="原文术语" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
            <input className={styles.input} placeholder="译文" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
            <button
              className={cn(styles.button, styles.press, "shrink-0")}
              disabled={!draft.source.trim()}
              onClick={async () => {
                await addTerm(current.id, draft);
                setDraft({ source: "", target: "" });
              }}
            >
              <Plus className="size-4" /> 添加
            </button>
          </div>

          {/* Terms */}
          <div className="flex flex-col divide-y divide-border-subtle">
            {terms?.length === 0 && <p className="p-6 text-center text-sm text-text-3">还没有术语。</p>}
            {terms?.map((t) => (
              <TermRow key={t.id} term={t} />
            ))}
          </div>
        </div>
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
      {term.origin === "auto" && <span className={cn(styles.chip, "shrink-0")}>自动</span>}
      <button
        className="shrink-0 rounded-control p-2 text-text-3 hover:bg-surface-2 hover:text-red-500"
        onClick={() => deleteTerm(term.id)}
        aria-label="删除术语"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
