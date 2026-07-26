/**
 * AI-generated locales, kept in localStorage rather than Dexie: the active
 * catalog has to be readable synchronously before the first paint, which an
 * async IndexedDB read can't do. A pleasant side effect — the UI language
 * survives "clear all local data", same as the theme.
 *
 * Layout: one index entry listing the locales, one entry per catalog (~25 KB
 * each), so boot reads exactly one catalog and a write touches one key.
 */

const INDEX_KEY = "i18n.custom.index";
const catalogKey = (id: string) => `i18n.custom.${id}`;

export interface CustomLocaleMeta {
  id: string;
  /** The language's name in itself, e.g. "Français" — used as the picker label. */
  endonym: string;
  /** BCP-47 tag for `<html lang>`; "und" when the model couldn't identify one. */
  tag: string;
  dir: "ltr" | "rtl";
  generatedAt: number;
  /** How many keys were accepted; the rest fall back to English. */
  count: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded / private mode
  }
}

export function listCustomLocales(): CustomLocaleMeta[] {
  return read<CustomLocaleMeta[]>(INDEX_KEY) ?? [];
}

export function findCustomLocale(id: string): CustomLocaleMeta | undefined {
  return listCustomLocales().find((m) => m.id === id);
}

export function readCustomMessages(id: string): Record<string, string> | null {
  return read<Record<string, string>>(catalogKey(id));
}

/** Persist a locale. Returns false if storage rejected it (caller keeps it in memory). */
export function saveCustomLocale(meta: CustomLocaleMeta, messages: Record<string, string>): boolean {
  if (!write(catalogKey(meta.id), messages)) return false;
  const index = listCustomLocales().filter((m) => m.id !== meta.id);
  index.push(meta);
  return write(INDEX_KEY, index);
}

export function deleteCustomLocale(id: string): void {
  try {
    localStorage.removeItem(catalogKey(id));
  } catch {
    /* ignore */
  }
  write(
    INDEX_KEY,
    listCustomLocales().filter((m) => m.id !== id),
  );
}
