import { db } from "@/db/db";
import type { LangCode } from "@/types";
import { buildChain } from "@/features/providers/store";
import { getInjectionTerms } from "@/features/glossary/store";
import { translateTexts, type RunOptions } from "./engineA";
import type { JobOptions } from "./runJob";

/**
 * Re-translate only the blocks whose source text matches `match`, using the
 * current (possibly edited) glossary. Bypasses the cache read so edits take effect.
 * Returns the number of blocks regenerated.
 */
export async function regenerateBlocks(
  docId: string,
  match: (sourceText: string) => boolean,
  opts: JobOptions,
): Promise<number> {
  const doc = await db.documents.get(docId);
  if (!doc) return 0;

  const chain = await buildChain(opts.providerId, opts.googleFallback);
  if (!chain.length) throw new Error("没有可用的翻译提供商");

  const source: LangCode = doc.sourceLang === "auto" ? doc.detectedLang ?? "auto" : doc.sourceLang;
  const runOpts: RunOptions = {
    docId,
    source,
    target: doc.targetLang,
    chain,
    glossary: await getInjectionTerms(docId),
    useMemory: opts.memoryEnabled,
    forceFresh: true,
    signal: opts.signal,
  };

  const pages = await db.pages.where("docId").equals(docId).toArray();
  let total = 0;
  for (const page of pages) {
    const targets = page.blocks.filter((b) => match(b.text));
    if (!targets.length) continue;
    const res = await translateTexts(targets.map((b) => b.text), runOpts);
    const translations = { ...page.translations };
    targets.forEach((b, i) => {
      if (res[i]) translations[b.id] = res[i];
    });
    await db.pages.update(page.id, { translations });
    total += targets.length;
  }
  return total;
}

/** Regenerate every block whose source contains the given term. */
export async function regenerateForTerm(docId: string, termSource: string, opts: JobOptions): Promise<number> {
  const needle = termSource.trim().toLowerCase();
  if (!needle) return 0;
  return regenerateBlocks(docId, (text) => text.toLowerCase().includes(needle), opts);
}
