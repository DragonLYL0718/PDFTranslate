import { db } from "@/db/db";
import type { LangCode } from "@/types";

/** Cache key: identical source text + language pair -> reuse. */
export function tmKey(sl: LangCode, tl: LangCode, text: string): string {
  return `${sl}|${tl}|${text}`;
}

export async function tmGetMany(keys: string[]): Promise<Map<string, string>> {
  const rows = await db.memory.bulkGet(keys);
  const map = new Map<string, string>();
  rows.forEach((r, i) => {
    if (r) map.set(keys[i], r.targetText);
  });
  return map;
}

export async function tmPutMany(entries: { key: string; targetText: string }[]): Promise<void> {
  if (!entries.length) return;
  const now = Date.now();
  await db.memory.bulkPut(entries.map((e) => ({ id: e.key, targetText: e.targetText, createdAt: now })));
}

export async function clearMemory(): Promise<void> {
  await db.memory.clear();
}

export async function memoryCount(): Promise<number> {
  return db.memory.count();
}
