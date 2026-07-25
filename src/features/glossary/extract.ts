import { db } from "@/db/db";
import type { LangCode, Provider } from "@/types";
import { llmComplete } from "@/features/providers/translate";
import { langName } from "@/features/import/languages";
import { ensureAutoGlossary, upsertAutoTerms } from "./store";

/** Evenly sample up to `n` items from an array. */
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

function parsePairs(raw: string): { source: string; target: string }[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let arr: unknown;
  try {
    const obj = JSON.parse(text);
    arr = Array.isArray(obj) ? obj : (obj?.t ?? obj?.terms);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) try { arr = JSON.parse(m[0]); } catch { /* ignore */ }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      const o = x as { s?: string; d?: string; source?: string; target?: string };
      return { source: (o.s ?? o.source ?? "").trim(), target: (o.d ?? o.target ?? "").trim() };
    })
    .filter((p) => p.source && p.target);
}

/**
 * After a document is translated, ask the model to extract key proper nouns /
 * domain terms it used, and save them into the document's auto glossary.
 * Non-fatal: failures are swallowed by the caller.
 */
export async function extractAndSaveTerms(
  docId: string,
  docName: string,
  source: LangCode,
  target: LangCode,
  chain: Provider[],
  signal?: AbortSignal,
): Promise<number> {
  const provider = chain.find((p) => p.kind !== "google-free");
  if (!provider) return 0; // extraction needs an LLM provider

  const pages = (await db.pages.where("docId").equals(docId).toArray()).sort((a, b) => a.pageNumber - b.pageNumber);
  const pairs: [string, string][] = [];
  for (const p of pages) {
    for (const b of p.blocks) {
      const t = p.translations[b.id];
      if (t && b.text.length < 400) pairs.push([b.text, t]);
    }
  }
  if (!pairs.length) return 0;

  const system =
    "You extract key domain terms and proper nouns (people, products, technical terms, acronyms) " +
    "from parallel text, with the translation actually used. " +
    'Return ONLY JSON {"t":[{"s":"source term","d":"target term"}]}, at most 40 entries. ' +
    "Skip common words; keep only terms that must stay consistent across a document.";
  const user =
    `Language: ${langName(source)} -> ${langName(target)}\nParallel segments:\n` +
    JSON.stringify(sample(pairs, 40));

  const raw = await llmComplete(provider, system, user, signal);
  const terms = parsePairs(raw);
  if (!terms.length) return 0;

  const gid = await ensureAutoGlossary(docId, docName);
  await upsertAutoTerms(gid, terms);
  return terms.length;
}
