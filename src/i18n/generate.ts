import { readSettings } from "@/db/db";
import { buildChain } from "@/features/providers/store";
import { llmComplete } from "@/features/providers/translate";
import type { Provider } from "@/types";
import { en } from "./en";
import { t } from "./index";
import type { CustomLocaleMeta } from "./customStore";

/**
 * Generate a UI locale with the user's own AI provider: the English catalog is
 * translated key by key, validated, and stored locally.
 *
 * Two things this deliberately does NOT use:
 *  - `translateSegments`, whose parser pads/truncates to the expected count —
 *    exactly the failure we have to detect here.
 *  - a positional array (as `judgeTerms` does), because the key name is useful
 *    context for the model and a partly-good reply stays salvageable per key.
 */

/** Keys per request. Small enough that the model answers every one. */
const BATCH = 40;
/** Below this acceptance rate a batch is retried once with a stricter reminder. */
const RETRY_THRESHOLD = 0.6;

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(s: string): Set<string> {
  return new Set(Array.from(s.matchAll(PLACEHOLDER), (m) => m[1]));
}

/**
 * Reject anything that lost, invented or renamed a placeholder — a translation
 * missing its `{count}` would render a gap in the UI. Rejected keys are simply
 * not stored, so the resolved catalog serves English for them.
 */
function accept(source: string, out: unknown): out is string {
  if (typeof out !== "string") return false;
  const v = out.trim();
  if (!v) return false;
  // A reply far longer than the source is commentary, not a translation.
  if (v.length > source.length * 6 + 40) return false;
  const want = placeholders(source);
  const got = placeholders(v);
  return want.size === got.size && [...want].every((k) => got.has(k));
}

/** Tolerant JSON extraction, mirroring parseTranslations/parseVerdicts. */
function parseObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const o = JSON.parse(s);
      if (o && typeof o === "object" && !Array.isArray(o)) {
        const inner = (o as { m?: unknown }).m;
        return (inner && typeof inner === "object" ? inner : o) as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
    return null;
  };
  const m = text.match(/\{[\s\S]*\}/);
  return attempt(text) ?? (m ? attempt(m[0]) : null);
}

export interface LocaleIdentity {
  tag: string;
  dir: "ltr" | "rtl";
  endonym: string;
}

/**
 * Ask the model what language the user typed, so the picker can label it with a
 * proper endonym and `<html lang>` gets a real tag. Best-effort: a failure here
 * must not block generation.
 */
export async function identifyLanguage(
  provider: Provider,
  input: string,
  signal?: AbortSignal,
): Promise<LocaleIdentity> {
  const fallback: LocaleIdentity = { tag: "und", dir: "ltr", endonym: input.trim() };
  try {
    const raw = await llmComplete(
      provider,
      'Identify the language the user names. Reply with ONLY {"tag":"<BCP-47>","dir":"ltr|rtl",' +
        '"endonym":"<the language\'s own name for itself>"}. No commentary.',
      input.trim(),
      signal,
    );
    const obj = parseObject(raw);
    if (!obj) return fallback;
    const tag = String(obj.tag ?? "");
    return {
      tag: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : "und",
      dir: obj.dir === "rtl" ? "rtl" : "ltr",
      endonym: (typeof obj.endonym === "string" && obj.endonym.trim()) || fallback.endonym,
    };
  } catch {
    return fallback;
  }
}

function systemPrompt(identity: LocaleIdentity, stricter: boolean): string {
  const lines = [
    `You are localizing the UI of "PDFTranslate", a browser-based PDF translation app, from English into ${identity.endonym}${identity.tag !== "und" ? ` (${identity.tag})` : ""}.`,
    "- Reply with ONLY a JSON object {\"m\":{ ...the same keys as the input... }}. Every input key must appear exactly once.",
    "- Keep every {placeholder} EXACTLY as written, same spelling, same count. Never translate or reorder a placeholder name.",
    "- These are UI strings: keep them terse, imperative for buttons, no trailing period on short labels.",
    "- Do NOT translate: PDFTranslate, BabelDOC, OpenAI, Anthropic, Gemini, Google, Ollama, API Key, CORS, PDF, JSON, URL.",
    "- No commentary, no markdown fences.",
  ];
  if (stricter) {
    lines.push('- Your previous reply lost placeholders. Copy every {name} verbatim into the translation.');
  }
  return lines.join("\n");
}

/** Translate one batch, returning only the entries that passed validation. */
async function translateBatch(
  provider: Provider,
  identity: LocaleIdentity,
  keys: string[],
  signal: AbortSignal | undefined,
  stricter: boolean,
): Promise<Record<string, string>> {
  const source = Object.fromEntries(keys.map((k) => [k, en[k as keyof typeof en]]));
  const raw = await llmComplete(
    provider,
    systemPrompt(identity, stricter),
    JSON.stringify({ m: source }),
    signal,
  );
  const obj = parseObject(raw);
  const out: Record<string, string> = {};
  if (!obj) return out;
  for (const k of keys) {
    const value = obj[k];
    if (accept(source[k], value)) out[k] = value.trim();
  }
  return out;
}

export interface GenerateResult {
  messages: Record<string, string>;
  /** Keys accepted, out of `total`. The rest fall back to English. */
  ok: number;
  total: number;
}

/**
 * Translate `keys` (defaults to the whole catalog) into the identified language.
 * Runs batches sequentially — providers rate-limit, and the progress bar makes
 * the wait legible. A failed batch is skipped, never fatal.
 */
export async function generateLocale(
  provider: Provider,
  identity: LocaleIdentity,
  opts: {
    keys?: string[];
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<GenerateResult> {
  // Sorted so a screen's keys travel together — better terminology consistency.
  const keys = (opts.keys ?? Object.keys(en)).slice().sort();
  const messages: Record<string, string> = {};

  for (let i = 0; i < keys.length; i += BATCH) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const slice = keys.slice(i, i + BATCH);
    let got: Record<string, string> = {};
    try {
      got = await translateBatch(provider, identity, slice, opts.signal, false);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
    }
    // A mostly-rejected batch usually means the model ignored the placeholder
    // rule; one stricter retry on just the stragglers is worth the tokens.
    const missing = slice.filter((k) => !(k in got));
    if (missing.length && got && slice.length - missing.length < slice.length * RETRY_THRESHOLD) {
      try {
        Object.assign(got, await translateBatch(provider, identity, missing, opts.signal, true));
      } catch (e) {
        if (opts.signal?.aborted) throw e;
      }
    }
    Object.assign(messages, got);
    opts.onProgress?.(Math.min(i + BATCH, keys.length), keys.length);
  }

  return { messages, ok: Object.keys(messages).length, total: keys.length };
}

/** The provider used for locale generation — google-free has no chat endpoint. */
export async function pickProvider(): Promise<Provider> {
  const settings = await readSettings();
  const chain = await buildChain(settings.lastOptions.providerId, false);
  const provider = chain.find((p) => p.kind !== "google-free");
  if (!provider) throw new Error(t("locale.needProvider"));
  return provider;
}

/** Keys a stored locale is missing relative to the current catalog. */
export function missingKeys(messages: Record<string, string>): string[] {
  return Object.keys(en).filter((k) => !messages[k]);
}

export function makeMeta(identity: LocaleIdentity, count: number): CustomLocaleMeta {
  return {
    id: crypto.randomUUID(),
    endonym: identity.endonym,
    tag: identity.tag,
    dir: identity.dir,
    generatedAt: Date.now(),
    count,
  };
}
