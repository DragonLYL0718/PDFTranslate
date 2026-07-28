import { db, readSettings } from "@/db/db";
import type { RagIndex } from "@/types";
import { SCHEME, buildIndex } from "./bm25";
import { chunkPages } from "./chunk";
import { collectDocText } from "./corpus";
import { buildEmbeddings, dropEmbeddings, embeddingCapable } from "./embed";
import { pickChatProvider } from "./runChat";

export interface BuildProgress {
  /** "extract" is the slow one — engine B re-reads both PDFs page by page. */
  phase: "extract" | "index" | "embed";
  done: number;
  total: number;
}

export interface BuildOptions {
  signal?: AbortSignal;
  onProgress?: (p: BuildProgress) => void;
  /** Non-fatal degradation (e.g. embeddings unavailable). */
  onNotice?: (message: string) => void;
}

export function getIndex(docId: string): Promise<RagIndex | undefined> {
  return db.chatIndexes.get(docId);
}

export async function dropIndex(docId: string): Promise<void> {
  await db.chatIndexes.delete(docId);
  await dropEmbeddings(docId);
}

export async function buildDocIndex(docId: string, opts: BuildOptions = {}): Promise<RagIndex> {
  const pages = await collectDocText(docId, {
    signal: opts.signal,
    onProgress: (done, total) => opts.onProgress?.({ phase: "extract", done, total }),
  });
  opts.signal?.throwIfAborted();
  opts.onProgress?.({ phase: "index", done: 0, total: 1 });
  const index = buildIndex(docId, chunkPages(docId, pages), pages.length);
  await db.chatIndexes.put(index);
  opts.onProgress?.({ phase: "index", done: 1, total: 1 });

  // Vectors are optional and cost money, so a failure here leaves a perfectly
  // usable keyword index behind rather than failing the build.
  const settings = await readSettings();
  if (settings.chatEmbeddingsEnabled && index.chunks.length) {
    try {
      const provider = await pickChatProvider();
      if (embeddingCapable(provider)) {
        await dropEmbeddings(docId);
        await buildEmbeddings(index, provider, settings.chatEmbeddingModel, {
          signal: opts.signal,
          onProgress: (done, total) => opts.onProgress?.({ phase: "embed", done, total }),
        });
      }
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      opts.onNotice?.(e instanceof Error ? e.message : String(e));
    }
  }
  return index;
}

// Opening the panel twice in a row must not build the same index twice.
const inFlight = new Map<string, Promise<RagIndex>>();

/** The document's index, building it if missing or produced by an older scheme. */
export async function ensureIndex(docId: string, opts: BuildOptions = {}): Promise<RagIndex> {
  const existing = await getIndex(docId);
  if (existing && existing.scheme === SCHEME) return existing;

  const running = inFlight.get(docId);
  if (running) return running;

  const build = buildDocIndex(docId, opts).finally(() => inFlight.delete(docId));
  inFlight.set(docId, build);
  return build;
}
