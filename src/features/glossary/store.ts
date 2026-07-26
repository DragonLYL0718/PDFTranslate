import { db, patchSettings, readSettings } from "@/db/db";
import { tDynamic } from "@/i18n";
import { en } from "@/i18n/en";
import { zh } from "@/i18n/zh";
import type { MessageKey } from "@/i18n/zh";
import type { Glossary, Term } from "@/types";
import type { GlossaryEntry } from "@/features/providers/translate";

function uid(): string {
  return crypto.randomUUID();
}

// ---- glossaries ----

/** Names the app generates itself; these follow the UI language until renamed. */
const DEFAULT_NAME_KEYS: MessageKey[] = [
  "glossary.defaultName",
  "glossary.untitled",
  "glossary.newName",
];

/**
 * Display name. App-supplied defaults are stored as a key and resolved here, so
 * switching the interface language relabels them; a name the user typed comes
 * back verbatim. `name` stays populated as a fallback for older records.
 */
export function glossaryName(g: Glossary): string {
  return (g.nameKey && tDynamic(g.nameKey, g.nameParams)) || g.name;
}

/** Fields for a glossary named by the app rather than by the user. */
function appNamed(
  nameKey: MessageKey,
  nameParams?: Record<string, string>,
): Pick<Glossary, "name" | "nameKey" | "nameParams"> {
  return { name: tDynamic(nameKey, nameParams), nameKey, nameParams };
}

async function insert(
  named: Pick<Glossary, "name" | "nameKey" | "nameParams">,
  extra: Partial<Glossary> = {},
): Promise<string> {
  const id = uid();
  await db.glossaries.put({ kind: "manual", createdAt: Date.now(), ...extra, ...named, id });
  return id;
}

export async function createGlossary(name: string): Promise<string> {
  const trimmed = name.trim();
  return trimmed ? insert({ name: trimmed }) : insert(appNamed("glossary.untitled"));
}

/** Create the "New glossary" entry the glossary page adds. */
export function createDefaultGlossary(): Promise<string> {
  return insert(appNamed("glossary.newName"));
}

export async function renameGlossary(id: string, name: string): Promise<void> {
  // Typing a name opts the glossary out of following the UI language.
  await db.glossaries.update(id, { name, nameKey: undefined, nameParams: undefined });
}

export async function deleteGlossary(id: string): Promise<void> {
  await db.transaction("rw", db.glossaries, db.terms, async () => {
    await db.terms.where("glossaryId").equals(id).delete();
    await db.glossaries.delete(id);
  });
  // Documents still pointing here fall back in `resolveTermTarget`.
  const s = await readSettings();
  if (s.defaultGlossaryId === id) await patchSettings({ defaultGlossaryId: null });
}

/** Find or create the auto-extraction glossary for a document. */
export async function ensureAutoGlossary(docId: string, docName: string): Promise<string> {
  const existing = await db.glossaries.where("docId").equals(docId).first();
  if (existing) return existing.id;
  return insert(appNamed("glossary.autoSuffix", { name: docName }), { kind: "auto", docId });
}

// ---- default / per-document target ----

let seeding: Promise<void> | undefined;

/**
 * Seed a shared library on first run so extracted terms have somewhere to go
 * other than a throwaway per-document glossary. Idempotent: StrictMode mounts
 * the root effect twice, and the check-then-create must not run as two
 * interleaved passes — otherwise the first run seeds two libraries.
 */
export function ensureDefaultGlossary(): Promise<void> {
  return (seeding ??= db.transaction("rw", db.settings, db.glossaries, async () => {
    await adoptDefaultNames();
    const s = await readSettings();
    if (s.defaultGlossaryId && (await db.glossaries.get(s.defaultGlossaryId))) return;
    const [manual] = await db.glossaries.where("kind").equals("manual").sortBy("createdAt");
    await patchSettings({
      defaultGlossaryId: manual?.id ?? (await insert(appNamed("glossary.defaultName"))),
    });
  }));
}

/**
 * Reattach name keys to glossaries created before names were translatable.
 * Only exact matches against the app's own former defaults are claimed, so a
 * glossary the user happened to name something else is never touched.
 */
async function adoptDefaultNames(): Promise<void> {
  for (const g of await db.glossaries.filter((x) => !x.nameKey).toArray()) {
    const key = DEFAULT_NAME_KEYS.find((k) => g.name === zh[k] || g.name === en[k]);
    if (key) await db.glossaries.update(g.id, { nameKey: key });
  }
}

export async function setDefaultGlossary(id: string | null): Promise<void> {
  await patchSettings({ defaultGlossaryId: id });
}

/**
 * Resolve where a document's auto-extracted terms belong, and remember the
 * answer on the document so the reader panel looks in the same place.
 *
 * Precedence: the document's own choice (made at import) → the default library
 * → a per-document "auto" glossary. `null` is an explicit "keep it per-document";
 * `undefined` — and a choice whose library has since been deleted — falls
 * through to the default.
 */
export async function resolveTermTarget(docId: string, docName: string): Promise<string> {
  const doc = await db.documents.get(docId);
  const chosen = doc?.glossaryId;
  if (chosen && (await db.glossaries.get(chosen))) return chosen;

  const preferred = chosen === null ? null : (await readSettings()).defaultGlossaryId;
  const id =
    preferred && (await db.glossaries.get(preferred))
      ? preferred
      : await ensureAutoGlossary(docId, docName);
  if (doc && doc.glossaryId !== id) await db.documents.update(docId, { glossaryId: id });
  return id;
}

/**
 * File the given terms into another library and point the document at it.
 * A per-document auto glossary left behind is dropped — it only ever held
 * these terms, and keeping it would clutter the glossary list. `fromId` is
 * passed in rather than read off the document, which may predate `glossaryId`.
 */
export async function adoptTerms(
  docId: string,
  fromId: string | null,
  terms: { source: string; target: string }[],
  targetId: string,
): Promise<void> {
  await upsertAutoTerms(targetId, terms);
  await db.documents.update(docId, { glossaryId: targetId });
  if (fromId && fromId !== targetId) {
    const old = await db.glossaries.get(fromId);
    if (old?.kind === "auto" && old.docId === docId) await deleteGlossary(fromId);
  }
}

// ---- terms ----

export async function addTerm(glossaryId: string, t: Pick<Term, "source" | "target" | "note">): Promise<void> {
  await db.terms.put({
    id: uid(),
    glossaryId,
    source: t.source.trim(),
    target: t.target.trim(),
    note: t.note,
    origin: "manual",
    createdAt: Date.now(),
  });
}

export async function updateTerm(id: string, patch: Partial<Term>): Promise<void> {
  await db.terms.update(id, patch);
}

export async function deleteTerm(id: string): Promise<void> {
  await db.terms.delete(id);
}

/**
 * Upsert auto-extracted terms into a glossary, skipping ones whose source
 * already exists (manual edits win).
 */
export async function upsertAutoTerms(glossaryId: string, pairs: { source: string; target: string }[]): Promise<void> {
  const existing = new Set((await db.terms.where("glossaryId").equals(glossaryId).toArray()).map((t) => t.source.toLowerCase()));
  const rows: Term[] = [];
  for (const p of pairs) {
    const source = p.source.trim();
    if (!source || existing.has(source.toLowerCase())) continue;
    existing.add(source.toLowerCase());
    rows.push({ id: uid(), glossaryId, source, target: p.target.trim(), origin: "auto", createdAt: Date.now() });
  }
  if (rows.length) await db.terms.bulkPut(rows);
}

/** Terms injected into translation for a document: all manual glossaries + this doc's auto glossary. */
export async function getInjectionTerms(docId: string): Promise<GlossaryEntry[]> {
  const glossaries = await db.glossaries.toArray();
  const ids = glossaries.filter((g) => g.kind === "manual" || g.docId === docId).map((g) => g.id);
  const terms = await db.terms.where("glossaryId").anyOf(ids).toArray();
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const t of terms) {
    if (!t.source || !t.target) continue;
    const key = t.source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: t.source, target: t.target });
  }
  return out.slice(0, 300);
}

// ---- import / export ----

export function termsToCsv(terms: Term[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = terms.map((t) => [t.source, t.target, t.note ?? ""].map(esc).join(","));
  return ["source,target,note", ...rows].join("\n");
}

/** Parse CSV (source,target,note) into term pairs. Tolerates quotes and a header row. */
export function parseCsv(text: string): { source: string; target: string; note?: string }[] {
  const out: { source: string; target: string; note?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
    const [source, target, note] = cells;
    if (!source || source.toLowerCase() === "source") continue;
    out.push({ source: source.trim(), target: (target ?? "").trim(), note: note?.trim() || undefined });
  }
  return out;
}

export async function importTerms(glossaryId: string, pairs: { source: string; target: string; note?: string }[]): Promise<number> {
  const rows: Term[] = pairs
    .filter((p) => p.source)
    .map((p) => ({ id: uid(), glossaryId, source: p.source, target: p.target, note: p.note, origin: "manual" as const, createdAt: Date.now() }));
  await db.terms.bulkPut(rows);
  return rows.length;
}
