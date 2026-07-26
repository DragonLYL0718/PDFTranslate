import type { MessageKey } from "@/i18n/zh";

// Core domain types shared across features.

export type EngineId = "heuristic" | "babeldoc";

/** ISO 639-1 code, or "auto" for source auto-detection. */
export type LangCode = string;

export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A grouped block of source text with its position on the page (PDF points, top-left origin). */
export interface TextBlock {
  id: string;
  bbox: Bbox;
  text: string;
  fontSize: number;
  /** "ltr" | "rtl" — reserved for future use. */
  dir: "ltr" | "rtl";
}

export interface PageData {
  pageNumber: number;
  /** Page size in PDF points. */
  width: number;
  height: number;
  blocks: TextBlock[];
}

export type DocStatus = "importing" | "ready" | "translating" | "translated" | "error";

export interface DocRecord {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  /** 1-based page numbers selected for translation; null = all. */
  selectedPages: number[] | null;
  sourceLang: LangCode; // "auto" allowed
  detectedLang?: LangCode;
  targetLang: LangCode;
  engine: EngineId;
  status: DocStatus;
  progress: number; // 0..1
  error?: string;
  /** Non-fatal problem with an otherwise finished translation (e.g. dropped paragraphs). */
  warning?: string;
  /**
   * Glossary that receives this document's auto-extracted terms. Unset means
   * "a per-document auto glossary", resolved lazily so the default can change.
   */
  glossaryId?: string | null;
  /** Original PDF bytes, kept locally. */
  data: ArrayBuffer;
  /** Translated PDF bytes from engine B (BabelDOC); undefined for engine A. */
  translatedData?: ArrayBuffer;
}

/** Per-page persisted content: source blocks + translated text keyed by block id. */
export interface DocPage {
  id: string; // `${docId}:${pageNumber}`
  docId: string;
  pageNumber: number;
  width: number;
  height: number;
  blocks: TextBlock[];
  translations: Record<string, string>;
}

export type ProviderKind = "openai" | "anthropic" | "gemini" | "google-free";

/** Reasoning/thinking strength. "off" = fast non-thinking (best default for translation). */
export type ReasoningLevel = "off" | "low" | "medium" | "high";

export interface Provider {
  id: string;
  name: string;
  /**
   * Set when `name` is an app-supplied default the user never chose, so it can
   * follow the interface language. Cleared as soon as they rename it.
   */
  nameKey?: MessageKey;
  kind: ProviderKind;
  baseURL: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  order: number;
  /** Optional advanced control; defaults to "off". */
  reasoning?: ReasoningLevel;
}

export interface LastOptions {
  sourceLang: LangCode;
  targetLang: LangCode;
  engine: EngineId;
  providerId: string | null;
  viewMode: "split" | "target" | "source";
}

export interface AppSettings {
  id: "app";
  lastOptions: LastOptions;
  /** Enable free Google Translate as a final fallback. */
  googleFallback: boolean;
  /** Route provider requests through the local proxy (bypasses browser CORS). */
  proxyEnabled: boolean;
  proxyUrl: string;
  /** URL for the local BabelDOC backend (probed on startup). */
  babelDocUrl: string;
  /** Reuse cached translations for identical segments. */
  memoryEnabled: boolean;
  /** After translating, auto-extract proper nouns into the document's glossary. */
  autoExtractTerms: boolean;
  /** How selective auto-extraction is about what counts as a term. */
  termStrictness: TermStrictness;
  /**
   * Glossary that auto-extracted terms land in by default. null = keep them in
   * a per-document "auto" glossary instead of a shared library.
   */
  defaultGlossaryId: string | null;
}

/** How selective term extraction is. "loose" keeps whatever the model proposes. */
export type TermStrictness = "loose" | "standard" | "strict";

/** A named term collection. "auto" glossaries are created per document for extracted terms. */
export interface Glossary {
  id: string;
  name: string;
  /** See Provider.nameKey — an app-supplied name that follows the UI language. */
  nameKey?: MessageKey;
  nameParams?: Record<string, string>;
  kind: "manual" | "auto";
  docId?: string;
  createdAt: number;
}

export interface Term {
  id: string;
  glossaryId: string;
  source: string;
  target: string;
  note?: string;
  origin: "manual" | "auto";
  createdAt: number;
}

/** Translation-memory record. id = `${sourceLang}|${targetLang}|${sourceText}`. */
export interface MemoryRecord {
  id: string;
  targetText: string;
  createdAt: number;
}

/** An annotation anchored to a page. */
export interface Annotation {
  id: string;
  docId: string;
  pageNumber: number;
  /** Plain-text search anchor (the text that was highlighted). */
  anchor: string;
  bbox: Bbox | null;
  color: string;
  comment: string;
  createdAt: number;
}
