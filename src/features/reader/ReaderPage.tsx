import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft,
  BookMarked,
  Columns2,
  Download,
  FileText,
  Languages,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  StickyNote,
} from "lucide-react";
import { t, type PlainKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { loadDocument } from "@/features/pdf/pdf";
import { runTranslationJob } from "@/features/engine/runJob";
import { translateWithEngineB } from "@/features/engine/engineB";
import type { DocPage } from "@/types";
import { PageView } from "./PageView";
import { TermsPanel } from "./TermsPanel";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { downloadBlob } from "@/lib/download";
import type { ExportMode } from "@/features/export/exportPdf";

type ViewMode = "split" | "source" | "target";

// `suffixKey` ends up in the download filename, not just the menu label.
const EXPORT_OPTIONS: { mode: ExportMode; labelKey: PlainKey; suffixKey: PlainKey }[] = [
  { mode: "original", labelKey: "reader.exportOriginal", suffixKey: "reader.suffixOriginal" },
  { mode: "translated", labelKey: "reader.exportTranslated", suffixKey: "reader.suffixTranslated" },
  { mode: "bilingual", labelKey: "reader.exportBilingual", suffixKey: "reader.suffixBilingual" },
];

/** Strip anything a filesystem would choke on — a locale can return any text. */
function safeSuffix(key: PlainKey): string {
  return t(key).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "export";
}

export function ReaderPage() {
  const { id = "" } = useParams();
  const settings = useSettings();
  const doc = useLiveQuery(() => db.documents.get(id), [id]);
  const pageRows = useLiveQuery(() => db.pages.where("docId").equals(id).toArray(), [id], []);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [transPdf, setTransPdf] = useState<PDFDocumentProxy | null>(null);
  const [mode, setMode] = useState<ViewMode>(settings.lastOptions.viewMode);
  const [scale, setScale] = useState(1.2);
  const [showTerms, setShowTerms] = useState(false);
  const [showAnnot, setShowAnnot] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarTimer = useRef<number | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [exportMenuOpen]);

  // Load PDF
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setLoadError(null);
    loadDocument(doc.data)
      .then((p) => !cancelled && setPdf(p))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
  }, [doc?.id]);

  // Load the BabelDOC-translated PDF (engine B) for the target view.
  useEffect(() => {
    if (!doc?.translatedData) { setTransPdf(null); return; }
    let cancelled = false;
    loadDocument(doc.translatedData.slice(0))
      .then((p) => !cancelled && setTransPdf(p))
      .catch((e) => !cancelled && console.error(t("reader.pdfLoadLogFailed"), e));
    return () => { cancelled = true; };
  }, [doc?.id, doc?.translatedData]);

  // Fullscreen (F) / toolbar (T) shortcuts. Bound unconditionally — scoping
  // this to `fullscreen` meant F could only ever *leave* fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack letters while the user is typing in a side panel.
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName ?? "")) return;
      if (e.key === "Escape") { setFullscreen(false); return; }
      if (e.key === "f" || e.key === "F") { setFullscreen((v) => !v); }
      if (e.key === "t" || e.key === "T") { setToolbarVisible((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-hide toolbar on mouse idle in fullscreen
  const resetToolbar = useCallback(() => {
    setToolbarVisible(true);
    window.clearTimeout(toolbarTimer.current ?? undefined);
    if (fullscreen) toolbarTimer.current = window.setTimeout(() => setToolbarVisible(false), 2500);
  }, [fullscreen]);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.addEventListener("mousemove", resetToolbar);
    el.addEventListener("mousedown", resetToolbar);
    return () => {
      el.removeEventListener("mousemove", resetToolbar);
      el.removeEventListener("mousedown", resetToolbar);
    };
  }, [resetToolbar]);

  const pagesByNum = useMemo(() => {
    const m = new Map<number, DocPage>();
    for (const p of pageRows ?? []) m.set(p.pageNumber, p);
    return m;
  }, [pageRows]);

  const showSource = mode !== "target";
  const showTarget = mode !== "source";
  const busy = doc?.status === "translating";

  // Re-run the document's own engine — engine B docs must not silently fall
  // back to engine A's overlay pipeline, which produces a different artifact.
  function retranslate() {
    if (!doc) return;
    if (doc.engine === "babeldoc") {
      translateWithEngineB(id, {
        source: doc.sourceLang,
        target: doc.targetLang,
        providerId: settings.lastOptions.providerId,
        autoExtract: settings.autoExtractTerms,
      }).catch(() => {});
      return;
    }
    runTranslationJob(id, {
      providerId: settings.lastOptions.providerId,
      googleFallback: settings.googleFallback,
      memoryEnabled: settings.memoryEnabled,
      autoExtract: settings.autoExtractTerms,
      // Re-running a finished document must bypass the memory read, or every
      // segment hits the cache and the "new" translation is byte-identical.
      // A retry after an error keeps the cache so finished pages stay cheap.
      forceFresh: doc.status === "translated",
    }).catch(() => {});
  }

  async function doExport(exportMode: ExportMode, suffixKey: PlainKey) {
    if (!doc) return;
    setExportMenuOpen(false);
    setExporting(true);
    try {
      const { exportTranslatedPdf } = await import("@/features/export/exportPdf");
      const bytes = await exportTranslatedPdf(id, { mode: exportMode });
      downloadBlob(bytes, `${doc.name.replace(/\.pdf$/i, "")}_${safeSuffix(suffixKey)}.pdf`);
    } catch (e) {
      alert(t("reader.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setExporting(false);
    }
  }

  if (doc === undefined) {
    return <Centered><Loader2 className="size-5 animate-spin" /> {t("reader.loading")}</Centered>;
  }
  if (doc === null) return <Centered>{t("reader.notFound")}<Link to="/" className="text-accent">{t("reader.back")}</Link></Centered>;

  return (
    <div
      ref={mainRef}
      className={cn(
        "flex min-h-dvh flex-col bg-bg text-text-1",
        fullscreen && "fixed inset-0 z-50",
      )}
    >
      {/* Toolbar — collapsible + auto-hide */}
      <header
        className={cn(
          "sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border-subtle bg-bg/90 px-4 py-2.5 backdrop-blur transition-[opacity,transform] duration-300",
          fullscreen && !toolbarVisible && "pointer-events-none -translate-y-full opacity-0",
        )}
      >
        <Link to="/" className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5")}>
          <ArrowLeft className="size-4" /> <span className="hidden sm:inline">{t("reader.back")}</span>
        </Link>
        <span className="mx-1 min-w-0 flex-1 truncate text-sm font-medium">{doc.name}</span>

        {busy && (
          <span className={cn(styles.chip, "text-accent")}>
            <Loader2 className="size-3.5 animate-spin" /> {Math.round(doc.progress * 100)}%
          </span>
        )}
        {!busy && (
          <button
            className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5")}
            onClick={retranslate}
          >
            <RefreshCw className="size-4" />
            {doc.status === "error"
              ? t("reader.retry")
              : doc.status === "translated"
                ? t("reader.retranslate")
                : t("reader.translate")}
          </button>
        )}

        <button
          onClick={() => setShowTerms((v) => !v)}
          className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5", showTerms && "border-accent text-accent")}
          title={t("reader.terms")}
        >
          <BookMarked className="size-4" />
        </button>
        <button
          onClick={() => setShowAnnot((v) => !v)}
          className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5", showAnnot && "border-accent text-accent")}
          title={t("reader.annotations")}
        >
          <StickyNote className="size-4" />
        </button>

        <div className="flex overflow-hidden rounded-control border border-border-subtle">
          <ModeBtn active={mode === "source"} onClick={() => setMode("source")} icon={<FileText className="size-4" />} label={t("reader.viewSource")} />
          <ModeBtn active={mode === "split"} onClick={() => setMode("split")} icon={<Columns2 className="size-4" />} label={t("reader.viewSplit")} />
          <ModeBtn active={mode === "target"} onClick={() => setMode("target")} icon={<Languages className="size-4" />} label={t("reader.viewTarget")} />
        </div>

        <div className="flex items-center rounded-control border border-border-subtle">
          <button className="px-2 py-1.5 hover:bg-surface-2" onClick={() => setScale((s) => Math.max(0.5, s - 0.1))} aria-label={t("reader.zoomOut")}>
            <Minus className="size-4" />
          </button>
          <span className="w-10 text-center font-mono text-xs text-text-3">{Math.round(scale * 100)}%</span>
          <button className="px-2 py-1.5 hover:bg-surface-2" onClick={() => setScale((s) => Math.min(3, s + 0.1))} aria-label={t("reader.zoomIn")}>
            <Plus className="size-4" />
          </button>
        </div>

        {!fullscreen && (
          <button className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5")} onClick={() => setFullscreen(true)} title={t("reader.fullscreen")}>
            <Maximize2 className="size-4" />
          </button>
        )}
        {fullscreen && (
          <button className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5")} onClick={() => setFullscreen(false)} title={t("reader.exitFullscreen")}>
            <Minimize2 className="size-4" />
          </button>
        )}
        <div className="relative" ref={exportMenuRef}>
          <button
            className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5")}
            onClick={() => setExportMenuOpen((v) => !v)}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            <span className="hidden sm:inline">{t("reader.export")}</span>
          </button>
          {exportMenuOpen && (
            <div className={cn(styles.card, "absolute right-0 top-full z-20 mt-1 min-w-32 overflow-hidden p-1")}>
              {EXPORT_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  className="w-full whitespace-nowrap rounded-control px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                  onClick={() => doExport(opt.mode, opt.suffixKey)}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {doc.status === "error" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-red-500/10 px-4 py-2 text-sm text-red-500">
          <span>{t("reader.translateFailed", { error: doc.error ?? "" })}</span>
        </div>
      )}
      {doc.status !== "error" && doc.warning && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-amber-500/10 px-4 py-2 text-sm text-amber-600">
          <span className="whitespace-pre-line">{doc.warning}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="flex-1 overflow-auto p-4 pretty-scrollbar">
          {loadError ? (
            <Centered>
              <span className="text-red-500">{t("reader.pdfLoadFailed", { error: loadError })}</span>
              <button
                className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5")}
                onClick={() => {
                  setLoadError(null);
                  loadDocument(doc.data)
                    .then(setPdf)
                    .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
                }}
              >
                <RefreshCw className="size-4" /> {t("reader.retry")}
              </button>
            </Centered>
          ) : !pdf ? (
            <Centered><Loader2 className="size-5 animate-spin" /> {t("reader.rendering")}</Centered>
          ) : (
            <div className="flex flex-col items-center gap-6">
              {Array.from({ length: doc.pageCount }, (_, i) => i + 1).map((n) => (
                <div key={n} className="flex flex-wrap justify-center gap-4">
                  {showSource && <PageView pdf={pdf} pageNumber={n} scale={scale} translated={false} />}
                  {showTarget && (
                    doc.engine === "babeldoc" ? (
                      transPdf && n <= transPdf.numPages ? (
                        <PageView pdf={transPdf} pageNumber={n} scale={scale} translated={false} />
                      ) : (
                        <div className="grid min-h-40 w-64 place-items-center rounded-card border border-border-subtle text-sm text-text-3">
                          {doc.status === "translating"
                            ? t("reader.translating")
                            : doc.status === "error"
                              ? t("reader.translateError")
                              : t("reader.awaitingTranslation")}
                        </div>
                      )
                    ) : (
                      <PageView pdf={pdf} pageNumber={n} page={pagesByNum.get(n)} scale={scale} translated />
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
        {showTerms && <TermsPanel docId={id} docName={doc.name} onClose={() => setShowTerms(false)} />}
        {showAnnot && <AnnotationsPanel docId={id} onClose={() => setShowAnnot(false)} />}
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
        active ? "bg-accent text-white" : "hover:bg-surface-2",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center gap-2 text-sm text-text-3">{children}</div>;
}
