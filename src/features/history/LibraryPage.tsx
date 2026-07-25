import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { ImportDialog, type PendingImport } from "@/features/import/ImportDialog";
import { runTranslationJob, type JobOptions } from "@/features/engine/runJob";
import { translateWithEngineB } from "@/features/engine/engineB";
import { HistoryList } from "./HistoryList";

export function LibraryPage() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptFile(file: File) {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("请选择 PDF 文件");
      return;
    }
    const data = await file.arrayBuffer();
    setPending({ name: file.name, size: file.size, data });
  }

  async function importUrl() {
    if (!url.trim()) return;
    setUrlBusy(true);
    setError(null);
    try {
      const res = await fetch(url.trim());
      if (!res.ok) throw new Error(`下载失败 ${res.status}`);
      const data = await res.arrayBuffer();
      const name = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "document.pdf");
      setPending({ name: name.endsWith(".pdf") ? name : name + ".pdf", size: data.byteLength, data });
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "链接导入失败（可能被 CORS 阻止）");
    } finally {
      setUrlBusy(false);
    }
  }

  function onStart(docId: string, job: JobOptions) {
    setPending(null);
    runTranslationJob(docId, job).catch(() => {});
    navigate(`/reader/${docId}`);
  }

  function onStartEngineB(docId: string, source: string, target: string, providerId: string | null) {
    setPending(null);
    translateWithEngineB(docId, source, target, providerId).catch(() => {});
    navigate(`/reader/${docId}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className={styles.kicker}>文档库</span>
        <h1 className={styles.pageTitle}>我的翻译</h1>
        <p className={styles.muted}>所有文档与翻译仅保存在本地浏览器，不上传云端。</p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) acceptFile(file);
        }}
        onClick={() => fileInput.current?.click()}
        className={cn(
          styles.card,
          "flex cursor-pointer flex-col items-center justify-center gap-3 border-dashed py-14 text-center transition-colors",
          dragging && "border-accent bg-accent-soft",
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Upload className="size-6" />
        </span>
        <div className="font-medium">拖拽 PDF 到此处，或点击上传</div>
        <p className={styles.muted}>数据只存本地 · 上传后可选翻译页数范围</p>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && acceptFile(e.target.files[0])}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
          <input
            className={cn(styles.input, "pl-9")}
            placeholder="或粘贴 PDF 网络链接…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && importUrl()}
          />
        </div>
        <button className={cn(styles.buttonGhost, styles.press)} onClick={importUrl} disabled={urlBusy || !url.trim()}>
          {urlBusy ? <Loader2 className="size-4 animate-spin" /> : null}
          导入链接
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <HistoryList />

      <ImportDialog pending={pending} onClose={() => setPending(null)} onStart={onStart} onStartEngineB={onStartEngineB} />
    </div>
  );
}
