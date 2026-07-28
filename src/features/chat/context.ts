// Choosing what of the document to send with a question, and formatting it.

import type { ChatQuote, RagChunk, RagEmbeddings, RagIndex } from "@/types";
import { search } from "./bm25";
import { vectorRank } from "./embed";
import { isCjkChar, tokenize } from "./tokenize";

/** Ceiling on retrieved context, regardless of how many passages were asked for. */
const CHAT_CHAR_BUDGET = 12_000;
/** A summary sees the whole document, so it gets a much larger slice. */
const SUMMARY_CHAR_BUDGET = 24_000;

/** Rough token count. CJK runs about one token per character, Latin about four. */
export function approxTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (isCjkChar(ch)) cjk++;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

/**
 * Passages as the model sees them. Chat turns carry the translation too — it
 * keeps terminology aligned with the text the reader is actually looking at,
 * and six passages make that cheap. The summary omits it: at 24K characters the
 * second copy would double a one-shot call that the language instruction
 * already handles.
 */
export function formatPassages(chunks: RagChunk[], withTranslation: boolean): string {
  return chunks
    .map((c) => {
      const head = `[p${c.pageNumber}] ${c.text}`;
      return withTranslation && c.translated ? `${head}\n    ↳ ${c.translated}` : head;
    })
    .join("\n\n");
}

function trimToBudget(chunks: RagChunk[], budget: number): RagChunk[] {
  const out: RagChunk[] = [];
  let used = 0;
  for (const c of chunks) {
    const size = c.text.length + (c.translated?.length ?? 0);
    if (out.length && used + size > budget) break;
    out.push(c);
    used += size;
  }
  return out;
}

export type ContextMode = "retrieved" | "sampled" | "none";

export interface DocContext {
  chunks: RagChunk[];
  /** Pages the passages came from, for citation chips. */
  pages: number[];
  mode: ContextMode;
}

export interface RetrieveOptions {
  k: number;
  /** The composer's "include PDF content" toggle. */
  include: boolean;
  quote?: ChatQuote;
  /**
   * Chunks the previous answer was given. Retrieval runs fresh every turn, so
   * without these a follow-up ("say more") is answered against a different slice
   * of the document than the answer it is following up on — and the model then
   * disowns its own citations. Held to half of `k` so the topic can still move.
   */
  pinnedIds?: string[];
  /** Semantic ranking to fuse with the keyword one, when embeddings exist. */
  vector?: { embeddings: RagEmbeddings; queryVector: Float32Array };
}

/**
 * Reciprocal rank fusion. Chosen over score blending precisely because it never
 * needs BM25 scores and cosines calibrated against each other — only their
 * orderings. 60 is the constant from the original paper.
 */
const RRF_K = 60;

function fuse(rankings: number[][], k: number): number[] {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((chunkIndex, rank) => {
      scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + 1 / (RRF_K + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([chunkIndex]) => chunkIndex);
}

export function retrieve(
  index: RagIndex | undefined,
  question: string,
  opts: RetrieveOptions,
): DocContext {
  const empty: DocContext = { chunks: [], pages: [], mode: "none" };
  if (!opts.include || !index?.chunks.length) return empty;

  // A quote is a strong query in itself — searching with it finds the passages
  // around and about the selection, not just ones matching the question.
  const query = opts.quote ? `${opts.quote.text}\n${question}` : question;
  const wanted = opts.k * 2;
  const lexical = search(index, query, wanted).map((h) => h.i);
  const ranked = opts.vector
    ? fuse([lexical, vectorRank(opts.vector.embeddings, opts.vector.queryVector, wanted)], wanted)
    : lexical;

  let picked = ranked.map((i) => index.chunks[i]);
  let mode: ContextMode = "retrieved";

  if (!picked.length) {
    // Nothing matched. Sampling beats answering blind, but the prompt has to
    // say these are samples so the model doesn't present them as the answer.
    const step = Math.max(1, Math.floor(index.chunks.length / opts.k));
    picked = index.chunks.filter((_, i) => i % step === 0).slice(0, opts.k);
    mode = picked.length ? "sampled" : "none";
  }

  if (opts.quote) {
    // The selected page first: it is the one passage we know is relevant.
    const page = opts.quote.pageNumber;
    picked = [
      ...index.chunks.filter((c) => c.pageNumber === page),
      ...picked.filter((c) => c.pageNumber !== page),
    ];
  }

  if (opts.pinnedIds?.length) {
    const pinned = new Set(opts.pinnedIds.slice(0, Math.max(1, Math.floor(opts.k / 2))));
    picked = [
      ...index.chunks.filter((c) => pinned.has(c.id)),
      ...picked.filter((c) => !pinned.has(c.id)),
    ];
  }

  const seen = new Set<string>();
  const unique = picked.filter((c) => !seen.has(c.id) && seen.add(c.id));
  const chunks = trimToBudget(unique.slice(0, opts.k), CHAT_CHAR_BUDGET);
  return { chunks, pages: [...new Set(chunks.map((c) => c.pageNumber))].sort((a, b) => a - b), mode };
}

/**
 * Whether a question can stand on its own as a search query. "更加详细一点" and
 * "why?" carry no term that exists in the document, so searching with them
 * returns an arbitrary slice; the caller widens the query with what came before.
 */
export function isWeakQuery(index: RagIndex | undefined, question: string): boolean {
  if (!index) return false;
  const useful = new Set(tokenize(question).filter((term) => index.postings[term]));
  return useful.size < 3;
}

/**
 * A spread of the document for the summary. The opening and closing passages
 * are always included — title, abstract and conclusion carry most of what a
 * summary needs — and the rest is sampled evenly to fill the budget.
 */
export function summaryContext(index: RagIndex): RagChunk[] {
  const all = index.chunks;
  if (!all.length) return [];

  const picked = new Set<number>();
  for (const i of [0, 1, all.length - 2, all.length - 1]) {
    if (i >= 0 && i < all.length) picked.add(i);
  }
  let used = [...picked].reduce((n, i) => n + all[i].text.length, 0);

  const step = Math.max(1, Math.floor(all.length / 40));
  for (let i = 0; i < all.length && used < SUMMARY_CHAR_BUDGET; i += step) {
    if (picked.has(i)) continue;
    picked.add(i);
    used += all[i].text.length;
  }
  for (let i = 0; i < all.length && used < SUMMARY_CHAR_BUDGET; i++) {
    if (picked.has(i)) continue;
    picked.add(i);
    used += all[i].text.length;
  }

  return [...picked].sort((a, b) => a - b).map((i) => all[i]);
}
