import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X, RefreshCw, Trash2, Loader2, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { addTerm, deleteTerm, ensureAutoGlossary, updateTerm } from "@/features/glossary/store";
import { regenerateForTerm } from "@/features/engine/regenerate";
import type { Term } from "@/types";

interface Props {
  docId: string;
  docName: string;
  onClose: () => void;
}

/** Reader side panel: the document's auto-extracted terms, editable, with per-term region regeneration. */
export function TermsPanel({ docId, docName, onClose }: Props) {
  const settings = useSettings();
  const glossary = useLiveQuery(() => db.glossaries.where("docId").equals(docId).first(), [docId]);
  const terms =
    useLiveQuery(
      () => (glossary ? db.terms.where("glossaryId").equals(glossary.id).toArray() : Promise.resolve<Term[]>([])),
      [glossary?.id],
    ) ?? [];
  const [busy, setBusy] = useState<string | null>(null);
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
    const gid = await ensureAutoGlossary(docId, docName);
    await addTerm(gid, draft);
    setDraft({ source: "", target: "" });
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border-subtle bg-surface-1">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="font-semibold tracking-tight">术语</div>
        <button onClick={onClose} className="rounded-control p-1 text-text-3 hover:bg-surface-2" aria-label="关闭">
          <X className="size-4" />
        </button>
      </div>

      <p className="px-4 py-2 text-xs text-text-3">
        翻译自动抽取的专有名词。改译文后点 <RefreshCw className="inline size-3" /> 只重生成含该词的区域。
      </p>

      <div className="flex gap-2 px-4 pb-2">
        <input className={cn(styles.input, "flex-1")} placeholder="原文" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
        <input className={cn(styles.input, "flex-1")} placeholder="译文" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
        <button className={cn(styles.button, styles.press, "shrink-0 px-2")} disabled={!draft.source.trim()} onClick={addManual} aria-label="添加术语">
          <Plus className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pretty-scrollbar">
        {terms?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-text-3">翻译完成后会在此出现自动抽取的术语。</p>
        )}
        {terms?.map((t) => (
          <div key={t.id} className="flex flex-col gap-1.5 border-b border-border-subtle px-4 py-3">
            <div className="font-mono text-xs text-text-3">{t.source}</div>
            <div className="flex items-center gap-1.5">
              <input
                className={cn(styles.input, "flex-1 py-1.5")}
                defaultValue={t.target}
                onBlur={(e) => e.target.value !== t.target && updateTerm(t.id, { target: e.target.value })}
              />
              <button
                className="rounded-control p-1.5 text-text-3 hover:bg-surface-2 hover:text-accent disabled:opacity-50"
                onClick={() => regenerate(t.source)}
                disabled={busy !== null}
                title="重新生成含该词的区域"
              >
                {busy === t.source ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </button>
              <button
                className="rounded-control p-1.5 text-text-3 hover:bg-surface-2 hover:text-red-500"
                onClick={() => deleteTerm(t.id)}
                aria-label="删除术语"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Link to="/glossary" className="border-t border-border-subtle px-4 py-3 text-sm text-accent hover:underline">
        管理全部术语库 →
      </Link>
    </aside>
  );
}
