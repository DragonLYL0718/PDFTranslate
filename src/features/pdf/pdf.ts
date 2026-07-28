import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  Util,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageData } from "@/types";
import { groupIntoBlocks, type RawItem } from "@/features/layout/group";

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Load a PDF from bytes. pdf.js transfers/detaches the buffer, so we clone
 * to keep the caller's original ArrayBuffer intact for local storage.
 */
export async function loadDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const copy = data.slice(0);
  return await getDocument({ data: copy }).promise;
}

// pdf.js throws if two render() calls overlap on the same canvas (React
// StrictMode's double-effect-invoke in dev, or a scale/page change firing
// before the previous render settles, both trigger this in practice).
// Serialize renders per canvas so a new one only starts once the last is
// fully done — checking then cancelling the previous task isn't enough
// since cancel() itself doesn't take effect until pdf.js next pauses.
const canvasQueue = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

/** Render one page onto a canvas at the given scale. Returns CSS pixel size. */
export function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<{ width: number; height: number }> {
  const prev = canvasQueue.get(canvas) ?? Promise.resolve();
  const result = prev.then(() => renderPageNow(pdf, pageNumber, scale, canvas));
  canvasQueue.set(canvas, result.catch(() => {}));
  return result;
}

async function renderPageNow(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: viewport.width, height: viewport.height };
}

// Same serialization as renderPage: a scale change mid-render would otherwise
// leave two sets of spans stacked in the container.
const layerQueue = new WeakMap<HTMLElement, Promise<unknown>>();

/**
 * Mount a transparent, selectable text layer over a rendered page. Positioned
 * against the container, which must be sized exactly like the canvas — the
 * spans carry absolute CSS-pixel offsets derived from the same viewport.
 */
export function renderTextLayer(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  container: HTMLElement,
): Promise<void> {
  const prev = layerQueue.get(container) ?? Promise.resolve();
  const result = prev.then(() => renderTextLayerNow(pdf, pageNumber, scale, container));
  layerQueue.set(container, result.catch(() => {}));
  return result;
}

async function renderTextLayerNow(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  container: HTMLElement,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  container.replaceChildren();
  // pdf.js reads this to size glyphs; harmless now, required by older majors.
  container.style.setProperty("--scale-factor", String(scale));
  const layer = new TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  });
  await layer.render();
}

/** Extract text (grouped into blocks) and page geometry, in PDF points, top-left origin. */
export async function extractPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageData> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items: RawItem[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    // Map text-space transform into top-left-origin page space.
    const tx = Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (fontHeight <= 0) continue;
    // Skip rotated/vertical text (sidebar watermarks, rotated table headers).
    // Overlays are horizontal boxes, so rotated glyphs can't be rendered
    // correctly, and their misread x/y would splice them into body lines.
    if (Math.abs(tx[1]) > Math.abs(tx[0])) continue;
    // tx[4], tx[5] is the glyph baseline origin. Approximate typical Latin
    // font metrics (~80% ascent above baseline, ~20% descent below) instead
    // of treating the full font height as sitting above the baseline —
    // otherwise the box is shifted up and clips descenders (g/y/p/q).
    items.push({
      str: item.str,
      x: tx[4],
      y: tx[5] - fontHeight * 0.8,
      w: item.width,
      h: fontHeight,
    });
  }

  const blocks = groupIntoBlocks(items, pageNumber);
  return {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    blocks,
  };
}
