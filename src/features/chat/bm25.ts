// BM25 over the document's chunks. Hand-rolled because every library worth
// pulling in ships its own tokenizer, and the CJK/Latin handling in tokenize.ts
// is the whole point.

import type { RagChunk, RagIndex } from "@/types";
import { tokenize } from "./tokenize";

const K1 = 1.2;
const B = 0.75;

/** Bumped when chunking or tokenizing changes, so stale indexes rebuild themselves. */
export const SCHEME = 2;

/**
 * A chunk is indexed over its source text *and* its translation. That is what
 * makes a Chinese question find the right passage of an English paper: the
 * translation already exists, so cross-language recall costs nothing extra.
 */
function indexedText(chunk: RagChunk): string {
  return chunk.translated ? `${chunk.text}\n${chunk.translated}` : chunk.text;
}

export function buildIndex(docId: string, chunks: RagChunk[], pageCount: number): RagIndex {
  const postings: Record<string, [number, number][]> = {};
  let totalLen = 0;

  chunks.forEach((chunk, i) => {
    const terms = tokenize(indexedText(chunk));
    chunk.len = terms.length;
    totalLen += terms.length;
    const freq = new Map<string, number>();
    for (const term of terms) freq.set(term, (freq.get(term) ?? 0) + 1);
    for (const [term, n] of freq) (postings[term] ??= []).push([i, n]);
  });

  return {
    docId,
    scheme: SCHEME,
    builtAt: Date.now(),
    pageCount,
    chunks,
    postings,
    avgLen: chunks.length ? totalLen / chunks.length : 0,
  };
}

export interface Hit {
  /** Position in `index.chunks`, so rankings can be fused by identity. */
  i: number;
  chunk: RagChunk;
  score: number;
}

export function search(index: RagIndex, query: string, k: number): Hit[] {
  const total = index.chunks.length;
  if (!total) return [];
  const scores = new Map<number, number>();
  // Distinct terms only: CJK bigrams overlap heavily, and letting a term score
  // twice just because the query repeats it skews toward long queries.
  const terms = new Set(tokenize(query));

  for (const term of terms) {
    const list = index.postings[term];
    if (!list) continue;
    const df = list.length;
    const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
    for (const [i, tf] of list) {
      const len = index.chunks[i].len;
      const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / (index.avgLen || 1)));
      scores.set(i, (scores.get(i) ?? 0) + idf * norm);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([i, score]) => ({ i, chunk: index.chunks[i], score }));
}
