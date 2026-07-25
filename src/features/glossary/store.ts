import { db } from "@/db/db";
import type { Term } from "@/types";
import type { GlossaryEntry } from "@/features/providers/translate";

function uid(): string {
  return crypto.randomUUID();
}

// ---- glossaries ----

export async function createGlossary(name: string): Promise<string> {
  const id = uid();
  await db.glossaries.put({ id, name: name.trim() || "未命名术语库", kind: "manual", createdAt: Date.now() });
  return id;
}

export async function renameGlossary(id: string, name: string): Promise<void> {
  await db.glossaries.update(id, { name });
}

export async function deleteGlossary(id: string): Promise<void> {
  await db.transaction("rw", db.glossaries, db.terms, async () => {
    await db.terms.where("glossaryId").equals(id).delete();
    await db.glossaries.delete(id);
  });
}

/** Find or create the auto-extraction glossary for a document. */
export async function ensureAutoGlossary(docId: string, docName: string): Promise<string> {
  const existing = await db.glossaries.where("docId").equals(docId).first();
  if (existing) return existing.id;
  const id = uid();
  await db.glossaries.put({ id, name: `${docName}（自动）`, kind: "auto", docId, createdAt: Date.now() });
  return id;
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
