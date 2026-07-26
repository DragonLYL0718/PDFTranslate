import { useMemo, useSyncExternalStore } from "react";
import { en } from "./en";
import { zh, type Catalog, type MessageKey } from "./zh";
import { findCustomLocale, readCustomMessages } from "./customStore";

export type { Catalog, MessageKey } from "./zh";

/** "zh" | "en" | "custom:<uuid>" */
export type LocaleId = string;

const LOCALE_KEY = "i18n.locale";
const DETECTED_KEY = "i18n.detected";

/**
 * Fully resolved — every key present, so lookup is one property read instead of
 * walking a fallback chain. A custom locale missing some keys shows English for
 * those, never a bare dotted key.
 */
let active: Catalog = zh;
let localeId: LocaleId = "zh";
let version = 0;

// ---------------------------------------------------------------------------
// t()
// ---------------------------------------------------------------------------

/** Placeholder names inside a message, extracted at the type level. */
type Vars<S extends string> = S extends `${string}{${infer V}}${infer R}` ? V | Vars<R> : never;
// Bracket-wrapped so the union doesn't distribute and make params silently optional.
type Args<K extends MessageKey> = [Vars<(typeof zh)[K]>] extends [never]
  ? []
  : [Record<Vars<(typeof zh)[K]>, string | number>];

/**
 * Keys whose message takes no parameters — the only ones safe to look up
 * dynamically, since a key you don't know statically can't be given the right
 * params. Use it to type `labelKey` fields on const option arrays.
 */
export type PlainKey = {
  [K in MessageKey]: [Vars<(typeof zh)[K]>] extends [never] ? K : never;
}[MessageKey];

/** Substitute `{name}` placeholders. Unknown ones are left verbatim so they're findable. */
export function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Translate a message. A plain module function, not a hook — that's what lets
 * `throw new Error(t(...))` and `confirm(t(...))` work outside React.
 */
export function t<K extends MessageKey>(key: K, ...args: Args<K>): string {
  return interpolate(active[key] ?? zh[key] ?? key, args[0] as Record<string, string | number>);
}

/**
 * Look up a key that isn't known statically — one read back from IndexedDB.
 * Returns "" for an unknown key so the caller can fall back to its stored text.
 */
export function tDynamic(key: string, params?: Record<string, string | number>): string {
  const s = (active as Record<string, string>)[key] ?? (zh as Record<string, string>)[key];
  return s ? interpolate(s, params) : "";
}

/**
 * Like `t`, but pinned to zh or en. The PDF export draws text with a bundled
 * CJK font that has no Arabic/Devanagari/Thai/Cyrillic glyphs, so an
 * AI-generated locale would render as blank boxes.
 */
export function tExport<K extends MessageKey>(key: K, ...args: Args<K>): string {
  const base = localeId === "zh" ? zh : en;
  return interpolate(base[key], args[0] as Record<string, string | number>);
}

// ---------------------------------------------------------------------------
// Locale switching
// ---------------------------------------------------------------------------

function applyDocument(tag: string, dir: "ltr" | "rtl") {
  document.documentElement.lang = tag;
  document.documentElement.dir = dir;
  document.title = t("app.title");
}

/** Resolve `active` for an id, falling back to en if a custom catalog vanished. */
function applyLocale(id: LocaleId): LocaleId {
  if (id.startsWith("custom:")) {
    const uuid = id.slice("custom:".length);
    const messages = readCustomMessages(uuid);
    const meta = findCustomLocale(uuid);
    if (messages && meta) {
      active = { ...zh, ...en, ...messages } as Catalog;
      localeId = id;
      applyDocument(meta.tag === "und" ? "en" : meta.tag, meta.dir);
      return id;
    }
    id = "en";
  }
  localeId = id === "zh" ? "zh" : "en";
  active = localeId === "zh" ? zh : en;
  applyDocument(localeId === "zh" ? "zh-CN" : "en", "ltr");
  return localeId;
}

export function setLocale(id: LocaleId): void {
  const effective = applyLocale(id);
  try {
    localStorage.setItem(LOCALE_KEY, effective);
  } catch {
    /* ignore quota / private mode */
  }
  version++;
  window.dispatchEvent(new Event("localechange"));
}

export function getLocale(): LocaleId {
  return localeId;
}

// ---------------------------------------------------------------------------
// First-run detection
// ---------------------------------------------------------------------------

function browserLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : [navigator.language || ""];
}

/** Pick a built-in locale from the browser. Anything else gets English. */
export function detectLocale(): "zh" | "en" {
  for (const l of browserLanguages()) {
    const p = l.toLowerCase();
    if (p.startsWith("zh")) return "zh";
    if (p.startsWith("en")) return "en";
  }
  return "en";
}

/** The raw tag we detected on first run (e.g. "ja-JP"), for the "generate this language?" hint. */
export function detectedTag(): string {
  try {
    return localStorage.getItem(DETECTED_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Runs at module load, before the first render. The presence of the stored key
 * IS the "user has chosen" flag: absent means never chosen, so we detect and
 * pin the result — after that a browser-language change never overrides them.
 */
export function initI18n(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LOCALE_KEY);
  } catch {
    /* ignore */
  }
  if (!stored) {
    stored = detectLocale();
    try {
      localStorage.setItem(LOCALE_KEY, stored);
      // Same source detect() used, so the "generate this language?" hint agrees with it.
      localStorage.setItem(DETECTED_KEY, browserLanguages()[0] ?? "");
    } catch {
      /* ignore */
    }
  }
  const effective = applyLocale(stored);
  if (effective !== stored) {
    try {
      localStorage.setItem(LOCALE_KEY, effective);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

function subscribe(cb: () => void) {
  window.addEventListener("localechange", cb);
  return () => window.removeEventListener("localechange", cb);
}

/**
 * Reactive locale id. Used once, on the router in `main.tsx`, whose `key` makes
 * the whole tree remount — so every other component can call the plain `t()`.
 */
export function useLocale(): LocaleId {
  return useSyncExternalStore(subscribe, getLocale, () => "zh");
}

/** Escape hatch for a component that must re-render on locale change on its own. */
export function useT(): typeof t {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return useMemo(() => t, [version]);
}
