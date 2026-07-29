import {
  AnnotationMode,
  GlobalWorkerOptions,
  OPS,
  TextLayer,
  getDocument,
  Util,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Bbox, PageData } from "@/types";
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

/**
 * Render one page onto a canvas at the given scale. Returns CSS pixel size.
 * `hideAnnotations` drops the PDF's own annotation layer, which the spec paints
 * above the page content — a highlight kept from the source file would sit on
 * top of translated text it no longer lines up with.
 */
export function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement,
  hideAnnotations = false,
): Promise<{ width: number; height: number }> {
  const prev = canvasQueue.get(canvas) ?? Promise.resolve();
  const result = prev.then(() => renderPageNow(pdf, pageNumber, scale, canvas, hideAnnotations));
  canvasQueue.set(canvas, result.catch(() => {}));
  return result;
}

async function renderPageNow(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement,
  hideAnnotations: boolean,
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
  await page.render({
    canvasContext: ctx,
    viewport,
    annotationMode: hideAnnotations ? AnnotationMode.DISABLE : AnnotationMode.ENABLE,
  }).promise;
  return { width: viewport.width, height: viewport.height };
}

export interface PdfHighlight {
  bbox: Bbox;
  /** The annotation's own colour, so a green highlight doesn't come back yellow. */
  color: string;
}

/**
 * Highlights on a page, in PDF points with a top-left origin — the same space
 * as the app's own annotations, so one `* scale` places both.
 *
 * Two sources, because readers produce both. A live `/Highlight` annotation is
 * the tidy case. But annotating tools also flatten highlights into the page
 * content as plain filled rectangles, and those survive anything that rewrites
 * the page: BabelDOC re-emits them *after* the translated text it now sits on
 * top of, and an opaque fill buries the translation. Lifting them out and
 * repainting them as a blended layer is what keeps the text readable.
 */
export async function getPdfHighlights(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfHighlight[]> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const out: PdfHighlight[] = [];

  for (const a of await page.getAnnotations()) {
    if (a.subtype !== "Highlight" || a.hidden) continue;
    const color =
      a.color?.length >= 3 ? `rgb(${a.color[0]} ${a.color[1]} ${a.color[2]})` : "#fde047";
    // quadPoints is flat, 8 numbers per quad laid out as top-left, top-right,
    // bottom-left, bottom-right. One quad per highlighted line — keeping them
    // separate avoids a multi-line highlight becoming one block that also
    // covers the indent and the ragged end of the last line.
    const quads: ArrayLike<number> | undefined = a.quadPoints;
    if (quads?.length) {
      for (let i = 0; i + 7 < quads.length; i += 8) {
        out.push({ color, bbox: toBbox(viewport, quads[i], quads[i + 5], quads[i + 2], quads[i + 1]) });
      }
    } else if (a.rect?.length === 4) {
      out.push({ color, bbox: toBbox(viewport, a.rect[0], a.rect[1], a.rect[2], a.rect[3]) });
    }
  }

  out.push(...(await flattenedHighlights(page, viewport)));
  return out;
}

/** Text-line height in points: below is a rule, above is a panel, not a highlight. */
const MIN_BAND_H = 4;
const MAX_BAND_H = 30;
/** Post-merge, so a per-word fragment isn't judged on its own width. */
const MIN_BAND_W = 8;

/** Bright and saturated — paper, rules and figure greys are none of those. */
function isHighlighterColor(c: number[] | null): boolean {
  if (!c || c.length < 3) return false;
  const max = Math.max(c[0], c[1], c[2]);
  return max > 170 && max - Math.min(c[0], c[1], c[2]) > 60;
}

/**
 * Filled rectangles in the content stream that look like highlighter strokes.
 * Flattening tools emit one rect per word, so these are merged back into lines.
 */
async function flattenedHighlights(
  page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>,
  viewport: { transform: number[]; convertToViewportRectangle(rect: number[]): number[] },
): Promise<PdfHighlight[]> {
  const ops = await page.getOperatorList();
  const found: PdfHighlight[] = [];
  // The operator list is in PDF user space with an identity CTM; positions live
  // in the transform ops, so the path coordinates alone say nothing about where
  // the rectangle lands.
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let fill: number[] | null = null;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as never;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
    else if (fn === OPS.setFillRGBColor) fill = args;
    else if (fn === OPS.constructPath && ops.fnArray[i + 1] === OPS.fill) {
      // A lone rectangle. Anything with more subpaths is artwork, not a stroke.
      const [subOps, coords] = args as unknown as [number[], number[]];
      if (subOps.length !== 1 || subOps[0] !== OPS.rectangle) continue;
      if (!isHighlighterColor(fill)) continue;
      const m = Util.transform(viewport.transform, ctm);
      const [x, y, w, h] = coords;
      const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map((p) =>
        Util.applyTransform(p, m),
      );
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const bbox = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
      if (bbox.h < MIN_BAND_H || bbox.h > MAX_BAND_H) continue;
      found.push({ bbox, color: `rgb(${fill![0]} ${fill![1]} ${fill![2]})` });
    }
  }
  return mergeBands(found);
}

/** Fuse same-line, same-colour rects that touch, so a page holds bands not words. */
function mergeBands(rects: PdfHighlight[]): PdfHighlight[] {
  const out: PdfHighlight[] = [];
  const sorted = [...rects].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  for (const r of sorted) {
    const last = out.at(-1);
    const sameLine =
      last &&
      last.color === r.color &&
      Math.abs(last.bbox.y - r.bbox.y) < 1 &&
      Math.abs(last.bbox.h - r.bbox.h) < 1 &&
      // A space between two highlighted words is left unfilled by some tools.
      r.bbox.x <= last.bbox.x + last.bbox.w + 2;
    if (sameLine) {
      last.bbox.w = Math.max(last.bbox.x + last.bbox.w, r.bbox.x + r.bbox.w) - last.bbox.x;
    } else {
      out.push({ color: r.color, bbox: { ...r.bbox } });
    }
  }
  return out.filter((r) => r.bbox.w >= MIN_BAND_W);
}

function toBbox(
  viewport: { convertToViewportRectangle(rect: number[]): number[] },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Bbox {
  const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([x1, y1, x2, y2]);
  return {
    x: Math.min(vx1, vx2),
    y: Math.min(vy1, vy2),
    w: Math.abs(vx2 - vx1),
    h: Math.abs(vy2 - vy1),
  };
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
