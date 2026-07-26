import { t, tExport } from "@/i18n";
import { db } from "@/db/db";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import cjkFontUrl from "@/assets/fonts/NotoSansSC-Regular.ttf?url";

/** Fetch the bundled CJK font (same-origin asset — no external network dependency). */
async function fetchCjkFont(): Promise<Uint8Array> {
  const res = await fetch(cjkFontUrl);
  if (!res.ok) throw new Error(t("export.noFont"));
  return new Uint8Array(await res.arrayBuffer());
}

export type ExportMode = "original" | "translated" | "bilingual";

export interface ExportOptions {
  mode: ExportMode;
  /** Include annotation/highlight marks (as a summary page). Ignored for "original". */
  includeAnnotations?: boolean;
}

/**
 * Manually word-wrap text to fit maxWidth. pdf-lib's own drawText wrapping
 * only breaks on spaces (PDFDocument.defaultWordBreaks = [' ']) — Chinese
 * (and other CJK) translations have no spaces, so it never wraps and draws
 * the whole paragraph as one line running off the page. Wrap character by
 * character instead, which is always safe for CJK and merely not the
 * prettiest for Latin text.
 */
function wrapText(text: string, font: import("pdf-lib").PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    let current = "";
    for (const ch of rawLine) {
      const candidate = current + ch;
      if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** Draw the translated overlay (white-covered blocks + translated text) onto a page. */
function drawTranslatedOverlay(
  page: import("pdf-lib").PDFPage,
  docPage: { blocks: { id: string; bbox: { x: number; y: number; w: number; h: number }; fontSize: number }[]; translations: Record<string, string> },
  font: import("pdf-lib").PDFFont,
): void {
  const { height } = page.getSize();
  for (const block of docPage.blocks) {
    const text = docPage.translations[block.id];
    if (!text) continue;

    const origTop = height - block.bbox.y; // PDF-space y of the block's top edge
    const fontSize = Math.min(block.fontSize * 0.9, 14);
    const lineHeight = fontSize * 1.3;
    const lines = wrapText(text, font, fontSize, block.bbox.w);
    // Grow the covering box downward instead of clipping when the
    // translation needs more lines than the original block did.
    const boxHeight = Math.max(block.bbox.h, lines.length * lineHeight);

    page.drawRectangle({
      x: block.bbox.x,
      y: origTop - boxHeight,
      width: block.bbox.w,
      height: boxHeight,
      color: rgb(1, 1, 1),
    });

    let lineY = origTop - fontSize;
    for (const line of lines) {
      page.drawText(line, { x: block.bbox.x, y: lineY, size: fontSize, font, color: rgb(0, 0, 0) });
      lineY -= lineHeight;
    }
  }
}

/**
 * Engine B path: the backend already produced a translated PDF, so
 * "translated" is that file as-is and "bilingual" interleaves it page-by-page
 * with the original.
 */
async function exportFromTranslatedPdf(
  originalData: ArrayBuffer,
  translatedData: ArrayBuffer,
  mode: Exclude<ExportMode, "original">,
): Promise<Uint8Array> {
  if (mode === "translated") return new Uint8Array(translatedData);

  const srcPdf = await PDFDocument.load(originalData, { ignoreEncryption: true });
  const transPdf = await PDFDocument.load(translatedData, { ignoreEncryption: true });
  const outPdf = await PDFDocument.create();

  const count = Math.max(srcPdf.getPageCount(), transPdf.getPageCount());
  for (let i = 0; i < count; i++) {
    if (i < srcPdf.getPageCount()) {
      const [p] = await outPdf.copyPages(srcPdf, [i]);
      outPdf.addPage(p);
    }
    if (i < transPdf.getPageCount()) {
      const [p] = await outPdf.copyPages(transPdf, [i]);
      outPdf.addPage(p);
    }
  }
  return await outPdf.save();
}

/**
 * Build a PDF from the original doc + translations.
 * - "original": the untouched source PDF (no processing needed).
 * - "translated": each page with the source text replaced by the translation.
 * - "bilingual": each original page followed by its translated counterpart.
 */
export async function exportTranslatedPdf(
  docId: string,
  options: ExportOptions,
): Promise<Uint8Array> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error(t("error.docNotFound"));

  if (options.mode === "original") {
    return new Uint8Array(doc.data);
  }

  // Engine B (BabelDOC) returns a finished translated PDF instead of
  // per-block translations, so it never populates `db.pages`.
  if (doc.translatedData) {
    return await exportFromTranslatedPdf(doc.data, doc.translatedData, options.mode);
  }

  const pages = (await db.pages.where("docId").equals(docId).toArray()).sort(
    (a, b) => a.pageNumber - b.pageNumber,
  );
  const hasTranslation = pages.some((p) => Object.keys(p.translations).length > 0);
  if (!hasTranslation) throw new Error(t("export.noTranslation"));

  const srcPdf = await PDFDocument.load(doc.data, { ignoreEncryption: true });
  const outPdf = await PDFDocument.create();
  outPdf.registerFontkit(fontkit);

  const fontBytes = await fetchCjkFont();
  const cjkFont = await outPdf.embedFont(fontBytes, { subset: true });

  for (let i = 0; i < srcPdf.getPageCount(); i++) {
    const docPage = pages.find((p) => p.pageNumber === i + 1);

    if (options.mode === "bilingual") {
      const [original] = await outPdf.copyPages(srcPdf, [i]);
      outPdf.addPage(original);
    }

    const [translated] = await outPdf.copyPages(srcPdf, [i]);
    outPdf.addPage(translated);
    if (docPage) drawTranslatedOverlay(translated, docPage, cjkFont);
  }

  if (options.includeAnnotations) {
    const annots = await db.annotations.where("docId").equals(docId).toArray();
    if (annots.length) {
      const page = outPdf.addPage();
      page.drawText(tExport("export.annotationsTitle", { name: doc.name }), { x: 50, y: page.getHeight() - 50, size: 16, font: cjkFont });
      let y = page.getHeight() - 80;
      for (const a of annots) {
        page.drawText(tExport("export.annotationLine", { page: a.pageNumber, comment: a.comment }), { x: 50, y, size: 10, font: cjkFont, color: rgb(0.3, 0.3, 0.3) });
        y -= 18;
        if (y < 40) break;
      }
    }
  }

  return await outPdf.save();
}

/** Export pages as plain Markdown text. */
export async function exportMarkdown(docId: string, bilingual = true): Promise<string> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error(t("error.docNotFound"));

  const pages = (await db.pages.where("docId").equals(docId).toArray()).sort(
    (a, b) => a.pageNumber - b.pageNumber,
  );

  let md = `# ${doc.name}\n\n`;
  for (const p of pages) {
    md += `## ${t("export.mdPageHeading", { page: p.pageNumber })}\n\n`;
    for (const b of p.blocks) {
      const t = p.translations[b.id];
      if (t) {
        if (bilingual) md += `${b.text}\n\n> ${t}\n\n`;
        else md += `${t}\n\n`;
      } else if (!bilingual) {
        md += `${b.text}\n\n`;
      }
    }
  }
  return md;
}
