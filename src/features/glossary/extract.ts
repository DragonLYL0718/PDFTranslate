import { db, readSettings } from "@/db/db";
import { t } from "@/i18n";
import type { LangCode, Provider, Term, TermStrictness } from "@/types";
import { llmComplete } from "@/features/providers/translate";
import { langPromptName } from "@/features/import/languages";
import { extractPage, loadDocument } from "@/features/pdf/pdf";
import { buildChain } from "@/features/providers/store";
import { resolveTermTarget, upsertAutoTerms } from "./store";

/**
 * What each strictness level counts as a term, and how many to keep. Engine A
 * bakes `rule` into its extraction prompt; engine B can't (BabelDOC's prompt is
 * fixed and always runs), so it applies the same rule as a filtering pass over
 * what BabelDOC returned.
 */
const STRICTNESS: Record<TermStrictness, { max: number; rule: string }> = {
  loose: {
    max: 60,
    rule: "Keep any term whose translation should stay consistent across the document.",
  },
  standard: {
    max: 30,
    rule:
      "Keep only named entities (people, organisations, products, datasets, algorithm/theorem names) " +
      "and domain-specific technical terms or acronyms. " +
      "Drop generic academic vocabulary (method, result, participant, user study, evaluation, contribution, " +
      "figure, dataset size, related work), ordinary words, and anything a competent reader of the field " +
      "would not need a glossary for.",
  },
  strict: {
    max: 15,
    rule:
      "Keep ONLY terms that are specific to this document's subfield and would be mistranslated or " +
      "rendered inconsistently without a glossary: coined names, product/system/model names, datasets, " +
      "benchmarks, and established technical terms of art with a fixed accepted translation. " +
      "Drop everything else, including generic academic vocabulary, common nouns, ordinary verbs and " +
      "adjectives, and terms whose translation is obvious. Returning very few terms is correct; " +
      "returning an ordinary word is a failure.",
  },
};

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
 * domain terms it used, and save them into the glossary the document is filed
 * under. Throws so the caller can tell the user why nothing appeared — the
 * silent version left "auto-extract is on but my glossary is empty" unexplained.
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
  // Google Free has no chat endpoint, so there is nothing to extract terms with.
  if (!provider) throw new Error(t("error.termsNeedProvider"));

  const pairs = await collectParallelText(docId);
  if (!pairs.length) throw new Error(t("error.termsNoPairs"));

  const strictness = (await readSettings()).termStrictness;
  const terms = await askForTerms(provider, pairs, source, target, strictness, signal);
  if (!terms.length) return 0;

  await upsertAutoTerms(await resolveTermTarget(docId, docName), terms);
  return terms.length;
}

/**
 * Parallel source/target text for a document. Engine A has it block-by-block in
 * `pages`; engine B only leaves behind a translated PDF, so fall back to pairing
 * the two PDFs page by page — coarser, but the model only needs to see a term
 * next to its translation, not aligned paragraphs.
 */
async function collectParallelText(docId: string): Promise<[string, string][]> {
  const rows = (await db.pages.where("docId").equals(docId).toArray()).sort(
    (a, b) => a.pageNumber - b.pageNumber,
  );
  const pairs: [string, string][] = [];
  for (const p of rows) {
    for (const b of p.blocks) {
      const translated = p.translations[b.id];
      if (translated && b.text.length < 400) pairs.push([b.text, translated]);
    }
  }
  if (pairs.length) return pairs;

  const doc = await db.documents.get(docId);
  if (!doc?.translatedData) return [];
  const [original, translated] = await Promise.all([
    loadDocument(doc.data),
    loadDocument(doc.translatedData),
  ]);
  const count = Math.min(original.numPages, translated.numPages);
  for (const n of sample(Array.from({ length: count }, (_, i) => i + 1), 8)) {
    const [a, b] = await Promise.all([extractPage(original, n), extractPage(translated, n)]);
    const src = a.blocks.map((x) => x.text).join("\n").slice(0, 3000);
    const dst = b.blocks.map((x) => x.text).join("\n").slice(0, 3000);
    if (src && dst) pairs.push([src, dst]);
  }
  return pairs;
}

async function askForTerms(
  provider: Provider,
  pairs: [string, string][],
  source: LangCode,
  target: LangCode,
  strictness: TermStrictness,
  signal?: AbortSignal,
): Promise<{ source: string; target: string }[]> {
  const { max, rule } = STRICTNESS[strictness];
  const system =
    "You extract glossary terms from parallel text, with the translation actually used. " +
    `${rule} ` +
    `Return ONLY JSON {"t":[{"s":"source term","d":"target term"}]}, at most ${max} entries.`;
  const user =
    `Language: ${langPromptName(source)} -> ${langPromptName(target)}\nParallel segments:\n` +
    JSON.stringify(sample(pairs, 40));
  return parsePairs(await llmComplete(provider, system, user, signal));
}

// ---- strictness applied to an existing list ----

/** Entries judged per request — short enough that the model reads every line. */
const JUDGE_BATCH = 50;

/** Positional verdicts, or null when the reply can't be trusted. */
function parseVerdicts(raw: string, count: number): boolean[] | null {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let arr: unknown;
  try {
    const obj = JSON.parse(text);
    arr = Array.isArray(obj) ? obj : (obj as { k?: unknown })?.k;
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) try { arr = JSON.parse(m[0]); } catch { /* ignore */ }
  }
  if (!Array.isArray(arr) || arr.length !== count) return null;
  return arr.map((x) => x === 1 || x === true || x === "1");
}

/**
 * Ask for one keep/drop verdict per entry, aligned by position. Asking "list the
 * good ones" invites the model to echo the whole list back; a fixed-length digit
 * array forces it to rule on every entry, costs almost no output tokens, and
 * never lets a reworded reply corrupt a term. Null = unusable reply.
 */
async function judgeBatch(
  provider: Provider,
  terms: { source: string; target: string }[],
  rule: string,
  signal?: AbortSignal,
): Promise<boolean[] | null> {
  const system =
    "You audit a machine-extracted bilingual glossary. Such lists are generated indiscriminately, " +
    "so most entries do not belong in a glossary at all. Judge every entry on its own merits.\n" +
    `${rule}\n` +
    `Reply with ONLY JSON {"k":[1,0,…]}: exactly ${terms.length} numbers, in the input's order, ` +
    "1 = keep, 0 = drop. No prose, no term names.";
  const user = terms.map((t, i) => `${i + 1}. ${t.source} → ${t.target}`).join("\n");
  try {
    return parseVerdicts(await llmComplete(provider, system, user, signal), terms.length);
  } catch {
    return null;
  }
}

interface Verdicts {
  /** One flag per input term; entries in a failed batch stay `true`. */
  keep: boolean[];
  batches: number;
  /** Batches the model couldn't answer — kept untouched rather than dropped. */
  failed: number;
}

async function judgeTerms(
  provider: Provider,
  terms: { source: string; target: string }[],
  strictness: TermStrictness,
  signal?: AbortSignal,
): Promise<Verdicts> {
  const { rule } = STRICTNESS[strictness];
  const keep = new Array<boolean>(terms.length).fill(true);
  let batches = 0;
  let failed = 0;
  for (let i = 0; i < terms.length; i += JUDGE_BATCH) {
    const slice = terms.slice(i, i + JUDGE_BATCH);
    batches++;
    const verdict = await judgeBatch(provider, slice, rule, signal);
    if (!verdict) failed++;
    else verdict.forEach((v, j) => (keep[i + j] = v));
  }
  return { keep, batches, failed };
}

/**
 * Cut an already-extracted list down to the given strictness. Engine B starts
 * from terms BabelDOC chose with its own fixed prompt, so the rule has to be
 * applied as a second pass instead of at extraction time.
 *
 * Best-effort: an unusable reply leaves the input untouched rather than silently
 * emptying someone's glossary.
 */
export async function filterTermPairs(
  provider: Provider,
  terms: { source: string; target: string }[],
  strictness: TermStrictness,
  signal?: AbortSignal,
): Promise<{ source: string; target: string }[]> {
  if (strictness === "loose" || terms.length < 2) return terms;
  const { keep } = await judgeTerms(provider, terms, strictness, signal);
  const survivors = terms.filter((_, i) => keep[i]);
  return survivors.length ? survivors.slice(0, STRICTNESS[strictness].max) : terms;
}

export interface PrunePlan {
  strictness: TermStrictness;
  /** Auto-extracted entries that were judged (hand-added ones are never touched). */
  reviewed: number;
  /** Entries that fail the strictness, in glossary order. Nothing is deleted yet. */
  doomed: Term[];
  batches: number;
  /** Batches the model failed to answer; their entries were left in place. */
  failed: number;
}

/**
 * Work out which auto-extracted entries of an existing glossary fail `strictness`
 * — without deleting anything, so the user can see the list before agreeing to
 * it. Hand-added terms are excluded: the user put those there on purpose.
 */
export async function planPrune(
  glossaryId: string,
  strictness: TermStrictness,
  signal?: AbortSignal,
): Promise<PrunePlan> {
  const rows = await db.terms.where("glossaryId").equals(glossaryId).toArray();
  const auto = rows.filter((t) => t.origin === "auto");
  const empty = { strictness, reviewed: auto.length, doomed: [], batches: 0, failed: 0 };
  if (strictness === "loose" || auto.length < 2) return empty;

  const settings = await readSettings();
  const chain = await buildChain(settings.lastOptions.providerId, false);
  const provider = chain.find((p) => p.kind !== "google-free");
  if (!provider) throw new Error(t("error.pruneNeedProvider"));

  const { keep, batches, failed } = await judgeTerms(
    provider,
    auto.map((t) => ({ source: t.source, target: t.target })),
    strictness,
    signal,
  );
  return { ...empty, doomed: auto.filter((_, i) => !keep[i]), batches, failed };
}

export async function applyPrune(termIds: string[]): Promise<void> {
  if (termIds.length) await db.terms.bulkDelete(termIds);
}

/**
 * Re-run extraction for an already-translated document, using its own language
 * pair. Throws on failure so the caller can show the reason inline.
 */
export async function reextractTerms(
  docId: string,
  providerId: string | null,
  googleFallback: boolean,
): Promise<number> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error(t("error.docNotFound"));
  const chain = await buildChain(providerId, googleFallback);
  const source = doc.sourceLang === "auto" ? doc.detectedLang ?? "auto" : doc.sourceLang;
  return extractAndSaveTerms(docId, doc.name, source, doc.targetLang, chain);
}

/**
 * Append a non-fatal note to the document's warning banner. Term extraction
 * runs after a successful translation, so its problems must not be reported as
 * a failed job — but they must be reported.
 */
export async function noteTermWarning(docId: string, message: string): Promise<void> {
  const doc = await db.documents.get(docId);
  if (!doc || doc.warning?.includes(message)) return;
  await db.documents.update(docId, {
    warning: doc.warning ? `${doc.warning}\n${message}` : message,
  });
}
