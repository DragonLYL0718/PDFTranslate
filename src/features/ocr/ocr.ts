import type { PDFDocumentProxy } from "pdfjs-dist";

interface OcrBlock {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Detect whether a PDF page is likely a scanned image (few or no text items).
 * Returns true if less than 5 meaningful text items or total chars < 50.
 */
export function isScannedPage(items: { str: string }[]): boolean {
  const meaningful = items.filter((i) => i.str.trim().length > 2);
  const totalChars = items.reduce((s, i) => s + i.str.length, 0);
  return meaningful.length < 5 || totalChars < 50;
}

/**
 * Run OCR on a page canvas via tesseract.js (lazy-loaded).
 * Returns text blocks with approximate coordinates.
 */
export async function ocrPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale = 2, // Higher scale = better OCR, slower
  lang = "eng",
): Promise<OcrBlock[]> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang);

  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data } = await worker.recognize(canvas);
    const blocks: OcrBlock[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        const text = para.text.trim();
        if (!text) continue;
        const { x0, y0, x1, y1 } = para.bbox;
        blocks.push({
          text,
          x: x0 / scale,
          y: y0 / scale,
          w: (x1 - x0) / scale,
          h: (y1 - y0) / scale,
        });
      }
    }
    return blocks;
  } finally {
    await worker.terminate();
  }
}
