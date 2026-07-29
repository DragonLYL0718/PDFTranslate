import type { PDFDocumentProxy } from "pdfjs-dist";
import { t } from "@/i18n";
import type { DocPage, LangCode, PageData, Provider } from "@/types";
import { extractPage } from "@/features/pdf/pdf";
import { translateSegments, type GlossaryEntry, type TranslateParams } from "@/features/providers/translate";
import { tmGetMany, tmKey, tmPutMany } from "@/features/memory/tm";
import { applyProtection, restore, type Placeholder } from "@/features/protect/protect";

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

/**
 * Everything a set of segments needs before any provider call: what to send,
 * what came back from the cache, and how many requests are left. Planning is
 * split from running so a caller can total the batches of a whole document up
 * front and drive a progress bar off the only unit that takes real time.
 */
interface TextPlan {
  texts: string[];
  cleaned: string[];
  maps: Placeholder[][];
  /** Results so far — cache hits are already final; batch results land here. */
  out: string[];
  /** Segment indices grouped into one provider request each. */
  batches: number[][];
}

/** Protect + resolve the cache, leaving only the provider calls to make. */
async function planTexts(texts: string[], opts: RunOptions): Promise<TextPlan> {
  // Protect each segment: patterns like formulas/code/URLs become ⟦N⟧ placeholders
  const protection = texts.map((s) => (s.trim() ? applyProtection(s) : { cleaned: s, map: [] }));
  const cleaned = protection.map((p) => p.cleaned);
  const out = new Array<string>(texts.length).fill("");

  // Resolve cache hits first; only misses hit the provider.
  // Keyed on the ORIGINAL text, not the placeholder-protected `cleaned` —
  // once protection collapses a whole segment to a single pattern (a bare
  // page number, an email, a URL...), cleaned text degenerates to the same
  // "⟦0⟧" for every such segment, so keying on it would cross-contaminate
  // unrelated blocks' cached translations.
  let pending = cleaned.map((s, i) => (s.trim() ? i : -1)).filter((i) => i >= 0);
  if (opts.useMemory !== false && !opts.forceFresh && pending.length) {
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

  return {
    texts,
    cleaned,
    maps: protection.map((p) => p.map),
    out,
    batches: buildBatches(pending, cleaned),
  };
}

/** Copy in any pending segment the memory has learned since the plan was made. */
async function fillFromMemory(plan: TextPlan, opts: RunOptions): Promise<void> {
  const pending = plan.batches.flat();
  if (!pending.length) return;
  const keys = pending.map((i) => tmKey(opts.source, opts.target, plan.texts[i]));
  const hits = await tmGetMany(keys);
  pending.forEach((i, k) => {
    const hit = hits.get(keys[k]);
    if (hit !== undefined) plan.out[i] = hit;
  });
}

/** Run a plan's provider calls. `onBatch` fires once per batch, call or not. */
async function runPlan(plan: TextPlan, opts: RunOptions, onBatch?: () => void): Promise<string[]> {
  const params: TranslateParams = {
    source: opts.source,
    target: opts.target,
    glossary: opts.glossary,
    signal: opts.signal,
  };
  const writeCache = opts.useMemory !== false;
  const fresh: { key: string; targetText: string }[] = [];

  // A document is planned in full before any of it is translated, so a line
  // this page repeats from an earlier one (a running header, a caption) is
  // still marked pending — but the earlier page has since written it to the
  // memory. Re-check rather than pay the provider for the same text twice.
  if (writeCache && !opts.forceFresh) await fillFromMemory(plan, opts);

  for (const batch of plan.batches) {
    const idx = batch.filter((i) => !plan.out[i]);
    if (idx.length) {
      const res = await translateWithFallback(opts.chain, idx.map((i) => plan.cleaned[i]), params);
      idx.forEach((i, k) => {
        // Restore protected patterns (formulas/code/URLs) from the AI's output
        plan.out[i] = restore(res[k] ?? "", plan.maps[i]);
        if (writeCache && plan.out[i]) {
          fresh.push({ key: tmKey(opts.source, opts.target, plan.texts[i]), targetText: plan.out[i] });
        }
      });
    }
    onBatch?.();
  }
  if (fresh.length) await tmPutMany(fresh);
  return plan.out;
}

/** Public: translate a list of texts with the given run options (used by regeneration). */
export async function translateTexts(texts: string[], opts: RunOptions): Promise<string[]> {
  return runPlan(await planTexts(texts, opts), opts);
}

/** A page extracted and planned, waiting only on its provider calls. */
export interface PagePlan {
  page: PageData;
  plan: TextPlan;
  /** Provider calls this page still needs — 0 when the cache covered it. */
  batchCount: number;
}

/** Extract a page and work out what translating it will cost in requests. */
export async function planPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  opts: RunOptions,
): Promise<PagePlan> {
  const page = await extractPage(pdf, pageNumber);
  const plan = await planTexts(page.blocks.map((b) => b.text), opts);
  return { page, plan, batchCount: plan.batches.length };
}

/** Translate a planned page into a persistable DocPage. */
export async function runPagePlan(
  { page, plan }: PagePlan,
  opts: RunOptions,
  onBatch?: () => void,
): Promise<DocPage> {
  const translated = await runPlan(plan, opts, onBatch);
  const translations: Record<string, string> = {};
  page.blocks.forEach((b, i) => {
    if (translated[i]) translations[b.id] = translated[i];
  });
  return {
    id: `${opts.docId}:${page.pageNumber}`,
    docId: opts.docId,
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    blocks: page.blocks,
    translations,
  };
}
