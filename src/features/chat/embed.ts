// Optional semantic layer over BM25. Off by default: it costs tokens, and the
// lexical index already handles the cross-language case through the document's
// own translation. Every failure path here degrades to keyword-only.

import { db } from "@/db/db";
import { t } from "@/i18n";
import type { Provider, RagEmbeddings, RagIndex } from "@/types";
import { smartFetch, withTimeout } from "@/features/providers/net";
import { openaiBase } from "@/features/providers/util";

/** Providers rate-limit, and sequential batches keep the progress bar honest. */
const BATCH = 64;

/** Only the OpenAI-compatible shape exposes an /embeddings endpoint. */
export function embeddingCapable(provider: Provider | undefined): boolean {
  return !!provider && provider.kind === "openai" && !!provider.apiKey;
}

async function embedBatch(
  provider: Provider,
  model: string,
  input: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const res = await smartFetch(`${openaiBase(provider.baseURL)}/embeddings`, {
    method: "POST",
    signal: withTimeout(signal, 120_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) throw new Error(`Embeddings ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const rows = json.data;
  if (!Array.isArray(rows) || rows.length !== input.length) {
    throw new Error(t("chat.embedFallback"));
  }
  // Documented to come back in order; sorted anyway so a stray gateway can't
  // silently misalign vectors against chunks.
  return [...rows]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((r) => r.embedding as number[]);
}

/** L2-normalize so cosine similarity reduces to a dot product. */
function normalize(values: number[]): Float32Array {
  const out = new Float32Array(values.length);
  let sum = 0;
  for (const x of values) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < values.length; i++) out[i] = values[i] / norm;
  return out;
}

export interface EmbedOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export async function buildEmbeddings(
  index: RagIndex,
  provider: Provider,
  model: string,
  opts: EmbedOptions = {},
): Promise<RagEmbeddings> {
  // Source text only. Embedding models are multilingual, so a Chinese question
  // already matches an English passage — appending the translation would double
  // the token bill for recall BM25 is covering anyway.
  const texts = index.chunks.map((c) => c.text);
  const rows: Float32Array[] = [];

  for (let at = 0; at < texts.length; at += BATCH) {
    opts.signal?.throwIfAborted();
    const batch = await embedBatch(provider, model, texts.slice(at, at + BATCH), opts.signal);
    for (const vector of batch) rows.push(normalize(vector));
    opts.onProgress?.(Math.min(at + BATCH, texts.length), texts.length);
  }

  const dim = rows[0]?.length ?? 0;
  if (!dim) throw new Error(t("chat.embedFallback"));
  const packed = new Float32Array(rows.length * dim);
  rows.forEach((row, i) => packed.set(row, i * dim));

  const record: RagEmbeddings = {
    docId: index.docId,
    model,
    dim,
    chunkIds: index.chunks.map((c) => c.id),
    vectors: packed.buffer,
    builtAt: Date.now(),
  };
  await db.chatEmbeddings.put(record);
  return record;
}

/** Stored vectors for a document, only if they still line up with the index. */
export async function loadEmbeddings(
  index: RagIndex,
  model: string,
): Promise<RagEmbeddings | undefined> {
  const row = await db.chatEmbeddings.get(index.docId);
  if (!row || row.model !== model) return undefined;
  if (row.chunkIds.length !== index.chunks.length) return undefined;
  if (row.chunkIds[0] !== index.chunks[0]?.id) return undefined;
  return row;
}

export async function dropEmbeddings(docId: string): Promise<void> {
  await db.chatEmbeddings.delete(docId);
}

/** Embed one query, ready to rank against a document's vectors. */
export async function embedQuery(
  provider: Provider,
  model: string,
  query: string,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const [vector] = await embedBatch(provider, model, [query], signal);
  return normalize(vector);
}

/** Chunk indices ordered by cosine similarity to the query. */
export function vectorRank(embeddings: RagEmbeddings, query: Float32Array, k: number): number[] {
  const { dim } = embeddings;
  const all = new Float32Array(embeddings.vectors);
  const count = Math.floor(all.length / dim);
  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < count; i++) {
    let dot = 0;
    const offset = i * dim;
    for (let d = 0; d < dim; d++) dot += all[offset + d] * query[d];
    scored.push({ i, score: dot });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.i);
}
