import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft,
  BookMarked,
  BotMessageSquare,
  Columns2,
  Download,
  FileText,
  Languages,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  UnfoldHorizontal,
  RefreshCw,
  StickyNote,
} from "lucide-react";
import { t, type PlainKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db, patchSettings } from "@/db/db";
import { useSettings } from "@/store/useSettings";
import { loadDocument } from "@/features/pdf/pdf";
import { runTranslationJob } from "@/features/engine/runJob";
import { translateWithEngineB } from "@/features/engine/engineB";
import type { Bbox, ChatQuote, DocPage } from "@/types";
import type { CiteTarget } from "@/features/chat/ChatPanel";
import { PageView } from "./PageView";
import { TermsPanel } from "./TermsPanel";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { SelectionBubble } from "./SelectionBubble";
import { useTextSelection } from "./useTextSelection";
import { addAnnotation, listAnnotations } from "./annotationsStore";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { listProviders } from "@/features/providers/store";
import { downloadBlob } from "@/lib/download";
import type { ExportMode } from "@/features/export/exportPdf";

type ViewMode = "split" | "source" | "target";

// The right rail holds one panel at a time. Stacking them ate 150+px of page
// width for no benefit, and a third panel would make it unusable.
type RightPanel = "terms" | "annot" | "chat" | null;

// `suffixKey` ends up in the download filename, not just the menu label.
const EXPORT_OPTIONS: { mode: ExportMode; labelKey: PlainKey; suffixKey: PlainKey }[] = [
  { mode: "original", labelKey: "reader.exportOriginal", suffixKey: "reader.suffixOriginal" },
  { mode: "translated", labelKey: "reader.exportTranslated", suffixKey: "reader.suffixTranslated" },
  { mode: "bilingual", labelKey: "reader.exportBilingual", suffixKey: "reader.suffixBilingual" },
];

/** Strip anything a filesystem would choke on — a locale can return any text. */
/**
 * Fuse boxes that continue one another vertically into a single rect. Block
 * grouping is a heuristic, so a paragraph can arrive as one block per line, and
 * highlighting each of those separately reads as five findings, not one passage.
 * Boxes in another column stay separate — their x ranges don't overlap.
 */
function mergeBoxes(boxes: Bbox[]): Bbox[] {
  const out: Bbox[] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = out.at(-1);
    const sameColumn = last && box.x < last.x + last.w && last.x < box.x + box.w;
    const gap = last ? box.y - (last.y + last.h) : Infinity;
    // Generous vertical tolerance: every box here belongs to the same retrieved
    // passage, so fusing across a paragraph break inside it is still correct.
    // Leading commonly exceeds the glyph box, which is why this isn't 1.0.
    if (last && sameColumn && gap < 1.6 * Math.max(box.h, last.h)) {
      const right = Math.max(last.x + last.w, box.x + box.w);
      const bottom = Math.max(last.y + last.h, box.y + box.h);
      last.x = Math.min(last.x, box.x);
      last.y = Math.min(last.y, box.y);
      last.w = right - last.x;
      last.h = bottom - last.y;
    } else {
      out.push({ ...box });
    }
  }
  return out;
}

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
  const [panel, setPanel] = useState<RightPanel>(null);
  const [quote, setQuote] = useState<ChatQuote | undefined>(undefined);
  /** A canned question to fire once the chat panel mounts. Carries an id so a
   *  remount can't ask it twice. */
  const [pendingAsk, setPendingAsk] = useState<{ id: string; question: string } | null>(null);
  // Chat needs a provider that can hold a conversation; google-free has no chat endpoint.
  const providers = useLiveQuery(listProviders, [], []) ?? [];
  const chatReady = providers.some((p) => p.enabled && p.apiKey && p.kind !== "google-free");
  const [fullscreen, setFullscreen] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarTimer = useRef<number | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const [availWidth, setAvailWidth] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  /** Where a citation last jumped. `boxes` is empty when only the page is known. */
  const [cited, setCited] = useState<{ page: number; boxes: Bbox[] } | null>(null);
  const citeTimer = useRef<number | null>(null);

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
      // Letters and Escape both belong to the panel while focus is inside it.
      if (t?.closest("[data-chat]")) return;
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

  // Page width at scale 1, for the fit-to-width calculation.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    pdf.getPage(1).then((p) => !cancelled && setPageWidth(p.getViewport({ scale: 1 }).width));
    return () => { cancelled = true; };
  }, [pdf]);

  // Track the scroll area, which shrinks whenever a side panel opens.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadError, pdf]);

  const pagesByNum = useMemo(() => {
    const m = new Map<number, DocPage>();
    for (const p of pageRows ?? []) m.set(p.pageNumber, p);
    return m;
  }, [pageRows]);

  const showSource = mode !== "target";
  const showTarget = mode !== "source";
  const busy = doc?.status === "translating";

  // Fit the pages side by side rather than letting the row wrap — with a panel
  // open, two columns at a fixed zoom no longer fit and the translation would
  // silently drop below the original.
  const columns = showSource && showTarget ? 2 : 1;
  const fitScale = useMemo(() => {
    if (!pageWidth || !availWidth) return null;
    const gaps = (columns - 1) * 16;
    // Leave room for the scrollbar so fitting never causes a horizontal one.
    const usable = availWidth - gaps - 12;
    return Math.min(3, Math.max(0.5, usable / (pageWidth * columns)));
  }, [pageWidth, availWidth, columns]);
  const effectiveScale = settings.autoFitWidth && fitScale ? fitScale : scale;

  // Zooming is an explicit choice to size pages by hand, so it takes over from
  // auto-fit, starting from whatever is on screen so nothing jumps.
  function zoom(delta: number) {
    if (settings.autoFitWidth) patchSettings({ autoFitWidth: false });
    setScale(Math.min(3, Math.max(0.5, effectiveScale + delta)));
  }

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

  const { selection, clear: clearSelection } = useTextSelection(scrollRef, effectiveScale);
  const annotations = useLiveQuery(() => listAnnotations(id), [id], []) ?? [];
  const annotationsByPage = useMemo(() => {
    const m = new Map<number, typeof annotations>();
    for (const a of annotations) m.set(a.pageNumber, [...(m.get(a.pageNumber) ?? []), a]);
    return m;
  }, [annotations]);

  /** Carry a selection into the chat, optionally asking about it straight away. */
  function quoteSelection(ask?: string) {
    if (!selection) return;
    setQuote({ pageNumber: selection.pageNumber, text: selection.text, side: selection.side });
    setPanel("chat");
    setPendingAsk(ask ? { id: crypto.randomUUID(), question: ask } : null);
    clearSelection();
  }

  // With the panel already open, selecting text attaches it to the composer
  // straight away — the bubble's actions become shortcuts rather than the only
  // way in. Focus is deliberately left alone: moving it collapses the selection.
  useEffect(() => {
    if (!selection || panel !== "chat") return;
    setQuote({ pageNumber: selection.pageNumber, text: selection.text, side: selection.side });
  }, [selection, panel]);

  // Citations in a chat answer jump here. When the answer recorded which
  // passages it was given, the jump lands on those paragraphs rather than the
  // top of the page — on a dense two-column page that is the whole difference
  // between "somewhere on page 7" and "this sentence".
  const goToSource = useCallback(
    ({ page, blockIds }: CiteTarget) => {
      const el = pageRefs.current.get(page);
      const scroller = scrollRef.current;
      if (!el || !scroller) return;

      const ids = new Set(blockIds ?? []);
      const boxes = ids.size
        ? mergeBoxes(
            (pagesByNum.get(page)?.blocks ?? []).filter((b) => ids.has(b.id)).map((b) => b.bbox),
          )
        : [];

      // Rect maths rather than offsetTop: the pages sit in an unpositioned
      // wrapper, so offsetParent is not the scroll container.
      const offset = boxes.length ? Math.min(...boxes.map((b) => b.y)) * effectiveScale : 0;
      const top =
        scroller.scrollTop +
        (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) +
        offset -
        24;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });

      setCited({ page, boxes });
      if (citeTimer.current !== null) window.clearTimeout(citeTimer.current);
      citeTimer.current = window.setTimeout(() => setCited(null), 3400);
    },
    [pagesByNum, effectiveScale],
  );

  useEffect(() => () => {
    if (citeTimer.current !== null) window.clearTimeout(citeTimer.current);
  }, []);

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
        // Fixed height, not a minimum: the shell has to bound its own height for
        // `main`'s overflow-auto (and the side panels' h-full) to mean anything.
        // With min-h-dvh the row grew to fit every page, the body scrolled
        // instead, and a panel's composer scrolled away with it.
        "flex h-dvh flex-col bg-bg text-text-1",
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
          onClick={() => setPanel((p) => (p === "terms" ? null : "terms"))}
          className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5", panel === "terms" && "border-accent text-accent")}
          title={t("reader.terms")}
        >
          <BookMarked className="size-4" />
        </button>
        {chatReady && (
          // Named and accent-tinted even when inactive: as a bare monochrome
          // glyph among five other icon buttons, nobody read this as "ask the AI".
          <button
            onClick={() => setPanel((p) => (p === "chat" ? null : "chat"))}
            className={cn(
              styles.buttonGhost,
              styles.press,
              "px-2.5 py-1.5 text-accent",
              panel === "chat" ? "border-accent bg-accent-soft" : "border-accent/40",
            )}
            title={t("reader.chat")}
          >
            <BotMessageSquare className="size-4" />
            <span className="hidden font-medium lg:inline">{t("reader.chat")}</span>
          </button>
        )}
        <button
          onClick={() => setPanel((p) => (p === "annot" ? null : "annot"))}
          className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5", panel === "annot" && "border-accent text-accent")}
          title={t("reader.annotations")}
        >
          <StickyNote className="size-4" />
        </button>

        <div className="flex overflow-hidden rounded-control border border-border-subtle">
          <ModeBtn active={mode === "source"} onClick={() => setMode("source")} icon={<FileText className="size-4" />} label={t("reader.viewSource")} />
          <ModeBtn active={mode === "split"} onClick={() => setMode("split")} icon={<Columns2 className="size-4" />} label={t("reader.viewSplit")} />
          <ModeBtn active={mode === "target"} onClick={() => setMode("target")} icon={<Languages className="size-4" />} label={t("reader.viewTarget")} />
        </div>

        <button
          onClick={() => patchSettings({ autoFitWidth: !settings.autoFitWidth })}
          className={cn(styles.buttonGhost, styles.press, "px-2 py-1.5", settings.autoFitWidth && "border-accent text-accent")}
          title={t("reader.fitWidth")}
        >
          <UnfoldHorizontal className="size-4" />
        </button>

        <div className="flex items-center rounded-control border border-border-subtle">
          <button className="px-2 py-1.5 hover:bg-surface-2" onClick={() => zoom(-0.1)} aria-label={t("reader.zoomOut")}>
            <Minus className="size-4" />
          </button>
          <span className="w-10 text-center font-mono text-xs text-text-3">{Math.round(effectiveScale * 100)}%</span>
          <button className="px-2 py-1.5 hover:bg-surface-2" onClick={() => zoom(0.1)} aria-label={t("reader.zoomIn")}>
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
        <main ref={scrollRef} className="flex-1 overflow-auto p-4 pretty-scrollbar">
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
                <div
                  key={n}
                  ref={(el) => {
                    if (el) pageRefs.current.set(n, el);
                    else pageRefs.current.delete(n);
                  }}
                  className={cn(
                    "flex scroll-mt-4 justify-center gap-4 rounded-card transition-shadow duration-500",
                    !settings.autoFitWidth && "flex-wrap",
                    // Only when the passage itself couldn't be located, so the
                    // ring never competes with the paragraph highlight.
                    cited?.page === n && !cited.boxes.length && "ring-2 ring-accent",
                  )}
                >
                  {showSource && (
                    <PageView
                      pdf={pdf}
                      pageNumber={n}
                      scale={effectiveScale}
                      translated={false}
                      annotations={annotationsByPage.get(n)}
                      cited={cited?.page === n ? cited.boxes : undefined}
                    />
                  )}
                  {showTarget && (
                    doc.engine === "babeldoc" ? (
                      transPdf && n <= transPdf.numPages ? (
                        <PageView pdf={transPdf} pageNumber={n} scale={effectiveScale} translated={false} />
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
                      // Engine A's overlay sits on the source block boxes, so a
                      // cited paragraph highlights in this pane too.
                      <PageView
                        pdf={pdf}
                        pageNumber={n}
                        page={pagesByNum.get(n)}
                        scale={effectiveScale}
                        translated
                        cited={cited?.page === n ? cited.boxes : undefined}
                      />
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
        {panel === "terms" && <TermsPanel docId={id} docName={doc.name} onClose={() => setPanel(null)} />}
        {panel === "annot" && <AnnotationsPanel docId={id} onClose={() => setPanel(null)} />}
        {panel === "chat" && (
          <ChatPanel
            doc={doc}
            quote={quote}
            onClearQuote={() => setQuote(undefined)}
            onCite={goToSource}
            pendingAsk={pendingAsk}
            onPendingAskConsumed={() => setPendingAsk(null)}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {selection && (
        <SelectionBubble
          selection={selection}
          onAsk={() => quoteSelection()}
          onExplain={() => quoteSelection(t("chat.explainAsk"))}
          onHighlight={() => {
            addAnnotation(id, selection.pageNumber, selection.text, selection.bbox, "");
            clearSelection();
          }}
          onDone={clearSelection}
        />
      )}
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
