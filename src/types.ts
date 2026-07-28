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
  /**
   * Whether the reader's AI chat has already offered a summary. Unset means the
   * start card still shows; "skipped" is remembered so it doesn't come back.
   */
  chatSummary?: "done" | "skipped";
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
  /** Remembered state of the chat composer's "include PDF content" toggle. */
  chatIncludeContext: boolean;
  /** User-edited summary prompts, keyed by UI locale id ("zh", "en", "custom:…"). */
  chatSummaryPrompts: Record<string, string>;
  /** How many retrieved passages go into one chat turn. */
  chatContextChunks: number;
  /** Offer follow-up questions under each answer. Costs one small extra call. */
  chatSuggestions: boolean;
  /** Stream assistant replies; degrades automatically behind an old relay. */
  chatStreaming: boolean;
  /** Chat panel width in px. */
  chatPanelWidth: number;
  /** Scale reader pages to fit the available width instead of a manual zoom. */
  autoFitWidth: boolean;
  /** Augment keyword retrieval with embeddings. Costs tokens; OpenAI-compatible only. */
  chatEmbeddingsEnabled: boolean;
  chatEmbeddingModel: string;
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

/** A passage the user selected on the PDF and carried into a chat turn. */
export interface ChatQuote {
  pageNumber: number;
  text: string;
  /** Which pane it came from, so the prompt can say whether it's already translated. */
  side: "source" | "target";
}

/** One conversation about a document. A document can hold several. */
export interface ChatSession {
  id: string;
  docId: string;
  /** Derived from the first turn; "" until there is one. */
  title: string;
  createdAt: number;
  /** Last activity, so the history list opens on what was being read. */
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  docId: string;
  /** Which conversation this belongs to. */
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  quote?: ChatQuote;
  /** Pages the answer drew on, rendered as citation chips. */
  sources?: number[];
  /**
   * Chunks this turn was given. Two jobs: a citation can scroll to the exact
   * passage rather than the page, and the next turn can keep them in context so
   * a follow-up isn't answered against a freshly retrieved, different document.
   */
  chunkIds?: string[];
  /** Questions offered as one-click chips under the answer. */
  followups?: string[];
  /** Marks the generated summary so it can be regenerated in place. */
  kind?: "summary";
  /** Absent once the turn finished cleanly. */
  status?: "streaming" | "aborted" | "error";
  error?: string;
  createdAt: number;
}

/** One retrievable passage. Never spans pages, so a page citation is always exact. */
export interface RagChunk {
  id: string; // `${docId}:${pageNumber}:${ordinal}`
  pageNumber: number;
  text: string;
  /**
   * Aligned translation when the document has one. Indexed alongside the source
   * so a question in the reader's language matches a foreign-language paper.
   */
  translated?: string;
  /**
   * Engine A block ids this passage was built from, in reading order. Absent for
   * engine B, whose text only pairs at page granularity — that's the difference
   * between a citation landing on the paragraph and landing on the page.
   */
  blockIds?: string[];
  /** Token count of the indexed text, for BM25 length normalization. */
  len: number;
}

/** A document's search index. Whole thing in one row — BM25 scores over all of it. */
export interface RagIndex {
  docId: string;
  /** Bumped in code when chunking or tokenizing changes, forcing a rebuild. */
  scheme: number;
  builtAt: number;
  pageCount: number;
  chunks: RagChunk[];
  /** term -> [chunkIndex, termFrequency][] */
  postings: Record<string, [number, number][]>;
  avgLen: number;
}

/** Optional semantic index layered on top of BM25. OpenAI-compatible only. */
export interface RagEmbeddings {
  docId: string;
  model: string;
  dim: number;
  /** Chunk ids in vector order; a mismatch against the index invalidates these. */
  chunkIds: string[];
  /** Row-major packed Float32, L2-normalized so cosine is a plain dot product. */
  vectors: ArrayBuffer;
  builtAt: number;
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
