import { useState } from "react";
import { X, Plus, Trash2, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { addAnnotation, deleteAnnotation, updateAnnotation, listAnnotations } from "@/features/reader/annotationsStore";
import { useLiveQuery } from "dexie-react-hooks";

interface Props {
  docId: string;
  onClose: () => void;
}

export function AnnotationsPanel({ docId, onClose }: Props) {
  const annotations = useLiveQuery(() => listAnnotations(docId), [docId], []) ?? [];
  const [page, setPage] = useState("");
  const [comment, setComment] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function add() {
    const pn = parseInt(page, 10);
    if (!pn || !comment.trim()) return;
    await addAnnotation(docId, pn, "", null, comment.trim());
    setPage("");
    setComment("");
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-border-subtle bg-surface-1">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="font-semibold tracking-tight">标注</div>
        <button onClick={onClose} className="rounded-control p-1 text-text-3 hover:bg-surface-2">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3">
        <div className="flex gap-2">
          <input
            className={cn(styles.input, "w-16 shrink-0")}
            placeholder="页"
            value={page}
            onChange={(e) => setPage(e.target.value)}
          />
          <input
            className={cn(styles.input, "flex-1")}
            placeholder="评论…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className={cn(styles.button, styles.press, "shrink-0 px-2")} disabled={!page || !comment.trim()} onClick={add}>
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pretty-scrollbar">
        {annotations.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-text-3">暂无标注。输入页码和评论添加。</p>
        )}
        {annotations.map((a) => (
          <div key={a.id} className="border-b border-border-subtle px-4 py-3 text-sm">
            <div className="mb-1 flex items-center gap-2">
              <span className={cn(styles.chip, "text-xs")}>第{a.pageNumber}页</span>
              {a.anchor && <span className="truncate text-xs text-text-3">{a.anchor.slice(0, 60)}</span>}
            </div>
            {editingId === a.id ? (
              <div className="flex gap-1">
                <input
                  className={cn(styles.input, "flex-1")}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => {
                    if (editText !== a.comment) updateAnnotation(a.id, { comment: editText });
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setEditingId(null)}
                  autoFocus
                />
              </div>
            ) : (
              <p className="text-text-2">{a.comment}</p>
            )}
            <div className="mt-1 flex gap-1">
              <button
                className="rounded p-0.5 text-text-3 hover:bg-surface-2"
                onClick={() => { setEditingId(a.id); setEditText(a.comment); }}
              >
                <Pencil className="size-3" />
              </button>
              <button
                className="rounded p-0.5 text-text-3 hover:bg-surface-2 hover:text-red-500"
                onClick={() => deleteAnnotation(a.id)}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
