// Getting a document's text back out, for both engines.
//
// Engine A stores blocks and their translations in `pages`. Engine B never
// populates that table — it only leaves a translated PDF — so the two PDFs get
// re-extracted and paired page by page. Glossary extraction needed the same
// thing first (with a page cap, since it only samples), so both callers share
// this rather than keeping two copies of the fallback.

import { db } from "@/db/db";
import { extractPage, loadDocument } from "@/features/pdf/pdf";

export interface TextUnit {
  text: string;
  /** "" when the document isn't translated, or this unit has no translation. */
  translated: string;
  /** Engine A only — lets a caller write a revised translation back. */
  blockId?: string;
}

export interface PageText {
  pageNumber: number;
  /** "block" = engine A's aligned blocks; "page" = engine B's whole-page pairing. */
  granularity: "block" | "page";
  units: TextUnit[];
}

export interface CollectOptions {
  /** Cap re-extracted pages (engine B only). Unset = the whole document. */
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Evenly sample up to `n` items from an array. */
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

export async function collectDocText(
  docId: string,
  opts: CollectOptions = {},
): Promise<PageText[]> {
  const rows = (await db.pages.where("docId").equals(docId).toArray()).sort(
    (a, b) => a.pageNumber - b.pageNumber,
  );
  if (rows.length) {
    opts.onProgress?.(rows.length, rows.length);
    return rows.map((p) => ({
      pageNumber: p.pageNumber,
      granularity: "block" as const,
      units: p.blocks.map((b) => ({
        text: b.text,
        translated: p.translations[b.id] ?? "",
        blockId: b.id,
      })),
    }));
  }

  // Engine B: pair the original and translated PDFs page by page. Coarser than
  // block alignment, but it's all that document leaves behind.
  const doc = await db.documents.get(docId);
  if (!doc) return [];
  const original = await loadDocument(doc.data);
  const translated = doc.translatedData ? await loadDocument(doc.translatedData) : null;
  const count = translated ? Math.min(original.numPages, translated.numPages) : original.numPages;
  const all = Array.from({ length: count }, (_, i) => i + 1);
  const pages = opts.maxPages ? sample(all, opts.maxPages) : all;

  const out: PageText[] = [];
  for (const [i, n] of pages.entries()) {
    opts.signal?.throwIfAborted();
    const [a, b] = await Promise.all([
      extractPage(original, n),
      translated ? extractPage(translated, n) : null,
    ]);
    out.push({
      pageNumber: n,
      granularity: "page",
      units: [
        {
          text: a.blocks.map((x) => x.text).join("\n"),
          translated: b ? b.blocks.map((x) => x.text).join("\n") : "",
        },
      ],
    });
    opts.onProgress?.(i + 1, pages.length);
  }
  return out;
}

/**
 * Source/target pairs for terminology work. Blocks are kept short so the model
 * sees a term beside its translation; whole-page units are truncated instead,
 * since there is nothing shorter to fall back to.
 */
export async function collectParallelText(
  docId: string,
  opts: CollectOptions = {},
): Promise<[string, string][]> {
  const pages = await collectDocText(docId, opts);
  const pairs: [string, string][] = [];
  for (const page of pages) {
    for (const u of page.units) {
      if (!u.translated) continue;
      if (page.granularity === "block") {
        if (u.text.length < 400) pairs.push([u.text, u.translated]);
      } else {
        pairs.push([u.text.slice(0, 3000), u.translated.slice(0, 3000)]);
      }
    }
  }
  return pairs;
}
