import type { PDFDocumentProxy } from "pdfjs-dist";
import { t } from "@/i18n";
import type { DocPage, LangCode, Provider } from "@/types";
import { extractPage } from "@/features/pdf/pdf";
import { translateSegments, type GlossaryEntry, type TranslateParams } from "@/features/providers/translate";
import { tmGetMany, tmKey, tmPutMany } from "@/features/memory/tm";
import { applyProtection, restore } from "@/features/protect/protect";

export interface RunOptions {
  docId: string;
  source: LangCode;
  target: LangCode;
  chain: Provider[];
  glossary?: GlossaryEntry[];
  /** Reuse/write translation memory. Default true. */
  useMemory?: boolean;
  /** Skip the cache read (re-translate) but still write. Used by regeneration. */
  forceFresh?: boolean;
  signal?: AbortSignal;
}

const CHAR_BUDGET = 3000;

/** Try each provider in the chain until one succeeds. */
async function translateWithFallback(
  chain: Provider[],
  segments: string[],
  params: TranslateParams,
): Promise<string[]> {
  let lastErr: unknown;
  for (const provider of chain) {
    try {
      return await translateSegments(provider, segments, params);
    } catch (e) {
      if (params.signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(t("error.noTranslationProvider"));
}

/** Group the given segment indices into batches bounded by CHAR_BUDGET. */
function buildBatches(indices: number[], texts: string[]): number[][] {
  const batches: number[][] = [];
  let cur: number[] = [];
  let chars = 0;
  for (const i of indices) {
    if (chars + texts[i].length > CHAR_BUDGET && cur.length) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(i);
    chars += texts[i].length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Translate all segments (with memory reuse + protection); reports 0..1 as batches complete. */
async function translateAll(
  texts: string[],
  opts: RunOptions,
  onProgress?: (fraction: number) => void,
): Promise<string[]> {
  const params: TranslateParams = {
    source: opts.source,
    target: opts.target,
    glossary: opts.glossary,
    signal: opts.signal,
  };
  const out = new Array<string>(texts.length).fill("");
  const writeCache = opts.useMemory !== false;
  const readCache = writeCache && !opts.forceFresh;

  // Protect each segment: patterns like formulas/code/URLs become ⟦N⟧ placeholders
  const protectionMaps = texts.map((t) => (t.trim() ? applyProtection(t) : { cleaned: t, map: [] }));
  const cleanedTexts = protectionMaps.map((p) => p.cleaned);

  // Resolve cache hits first; only misses hit the provider.
  // Keyed on the ORIGINAL text, not the placeholder-protected `cleanedTexts` —
  // once protection collapses a whole segment to a single pattern (a bare
  // page number, an email, a URL...), cleaned text degenerates to the same
  // "⟦0⟧" for every such segment, so keying on it would cross-contaminate
  // unrelated blocks' cached translations.
  let pending = cleanedTexts.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
  if (readCache && pending.length) {
    const keys = pending.map((i) => tmKey(opts.source, opts.target, texts[i]));
    const hits = await tmGetMany(keys);
    const misses: number[] = [];
    pending.forEach((i, k) => {
      const hit = hits.get(keys[k]);
      if (hit !== undefined) out[i] = hit;
      else misses.push(i);
    });
    pending = misses;
  }

  const batches = buildBatches(pending, cleanedTexts);
  if (!batches.length) {
    onProgress?.(1);
    // Restore any cache-hit results before returning
    for (let i = 0; i < texts.length; i++) {
      if (out[i]) out[i] = restore(out[i], protectionMaps[i].map);
    }
    return out;
  }

  const fresh: { key: string; targetText: string }[] = [];
  for (let b = 0; b < batches.length; b++) {
    const idx = batches[b];
    const batchTexts = idx.map((i) => cleanedTexts[i]);
    const res = await translateWithFallback(opts.chain, batchTexts, params);
    idx.forEach((i, k) => {
      // Restore protected patterns (formulas/code/URLs) from the AI's output
      const restored = restore(res[k] ?? "", protectionMaps[i].map);
      out[i] = restored;
      if (writeCache && out[i]) fresh.push({ key: tmKey(opts.source, opts.target, texts[i]), targetText: out[i] });
    });
    onProgress?.((b + 1) / batches.length);
  }
  if (fresh.length) await tmPutMany(fresh);
  return out;
}

/** Public: translate a list of texts with the given run options (used by regeneration). */
export async function translateTexts(
  texts: string[],
  opts: RunOptions,
  onProgress?: (fraction: number) => void,
): Promise<string[]> {
  return translateAll(texts, opts, onProgress);
}

/** Extract + translate a single page into a persistable DocPage. */
export async function translatePage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  opts: RunOptions,
  onProgress?: (fraction: number) => void,
): Promise<DocPage> {
  const page = await extractPage(pdf, pageNumber);
  const texts = page.blocks.map((b) => b.text);
  const translated = await translateAll(texts, opts, onProgress);
  const translations: Record<string, string> = {};
  page.blocks.forEach((b, i) => {
    if (translated[i]) translations[b.id] = translated[i];
  });
  return {
    id: `${opts.docId}:${pageNumber}`,
    docId: opts.docId,
    pageNumber,
    width: page.width,
    height: page.height,
    blocks: page.blocks,
    translations,
  };
}
