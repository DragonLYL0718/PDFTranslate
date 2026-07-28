// Orchestrates one chat turn: pick a provider, retrieve context, stream the
// reply, persist it. The panel owns rendering; this owns everything else.

import { readSettings } from "@/db/db";
import { getLocale, t } from "@/i18n";
import type { ChatMessage, ChatQuote, DocRecord, Provider, RagIndex } from "@/types";
import { llmCall, type LlmMessage } from "@/features/providers/llm";
import { buildChain } from "@/features/providers/store";
import { appendMessage, listMessages, updateMessage } from "./chatStore";
import {
  formatPassages,
  isWeakQuery,
  retrieve,
  summaryContext,
  type RetrieveOptions,
} from "./context";
import { embedQuery, embeddingCapable, loadEmbeddings } from "./embed";
import {
  chatSystem,
  followupSystem,
  generateSummaryPrompt,
  needsGeneratedPrompt,
  resolveSummaryPrompt,
  withDocFacts,
  type DocFacts,
} from "./prompts";

/** How many earlier messages ride along. Older context is rarely worth the tokens. */
const HISTORY_TURNS = 10;

export interface TurnHandlers {
  /** Fires once the assistant row exists, so the panel can attach its buffer. */
  onAssistant?: (id: string) => void;
  /** Full text so far, not just the delta. */
  onDelta?: (text: string) => void;
  /** Non-fatal degradation worth telling the reader about. */
  onNotice?: (message: string) => void;
}

/** A provider that can actually hold a conversation — google-free has no chat endpoint. */
export async function pickChatProvider(): Promise<Provider> {
  const settings = await readSettings();
  const chain = await buildChain(settings.lastOptions.providerId, false);
  const provider = chain.find((p) => p.kind !== "google-free");
  if (!provider) throw new Error(t("chat.needProvider"));
  return provider;
}

export function docFacts(doc: DocRecord): DocFacts {
  return {
    name: doc.name,
    pageCount: doc.pageCount,
    sourceLang: doc.detectedLang ?? doc.sourceLang,
    targetLang: doc.targetLang,
    translated: doc.status === "translated" || !!doc.translatedData,
  };
}

/**
 * Replay of the conversation. The quote is folded back into the user turn it was
 * asked with: without it the model could see that it had been asked to explain
 * something, but not what — and would then disown the answer it had given.
 */
function history(prior: ChatMessage[]): LlmMessage[] {
  return prior
    .filter((m) => m.content && m.status !== "error")
    .slice(-HISTORY_TURNS)
    .map((m) => ({
      role: m.role,
      content: m.quote
        ? `[Selected on page ${m.quote.pageNumber}]\n${m.quote.text}\n\n${m.content}`
        : m.content,
    }));
}

/** The turn the model actually receives: passages, the selection, then the question. */
function composeTurn(
  question: string,
  passages: string,
  mode: string,
  quote?: ChatQuote,
): string {
  const parts: string[] = [];
  if (passages) {
    parts.push(
      mode === "sampled"
        ? "[Passages sampled from the document — no passage matched the question directly]"
        : "[Passages retrieved from the document]",
      passages,
    );
  }
  if (quote) {
    const side = quote.side === "target" ? "translation" : "source text";
    parts.push(`[The reader selected this on page ${quote.pageNumber}, in the ${side}]`, quote.text);
  }
  parts.push("[Question]", question);
  return parts.join("\n\n");
}

/**
 * Widen a query that can't stand alone. Search is a bag of words, so adding the
 * previous exchange costs nothing but recall of the topic being followed up on.
 */
function expandQuery(index: RagIndex | undefined, question: string, prior: ChatMessage[]): string {
  if (!isWeakQuery(index, question)) return question;
  const reversed = [...prior].reverse();
  const lastQuestion = reversed.find((m) => m.role === "user")?.content ?? "";
  const lastAnswer = reversed.find((m) => m.role === "assistant" && m.content)?.content ?? "";
  return [question, lastQuestion, lastAnswer.slice(0, 800)].filter(Boolean).join("\n");
}

/**
 * Stream a reply into a fresh assistant row, persisting once at the end — a
 * write per token would thrash every live query on the page.
 */
async function stream(
  provider: Provider,
  system: string,
  messages: LlmMessage[],
  meta: Pick<ChatMessage, "docId" | "sessionId" | "sources" | "chunkIds" | "kind">,
  signal: AbortSignal,
  handlers: TurnHandlers = {},
): Promise<{ id: string; text: string; complete: boolean }> {
  const settings = await readSettings();
  const row = await appendMessage({ ...meta, role: "assistant", content: "", status: "streaming" });
  handlers.onAssistant?.(row.id);

  let text = "";
  try {
    text = await llmCall(provider, {
      system,
      messages,
      signal,
      temperature: 0.4,
      maxTokens: 4096,
      onDelta: settings.chatStreaming
        ? (piece) => {
            text += piece;
            handlers.onDelta?.(text);
          }
        : undefined,
    });
    await updateMessage(row.id, { content: text, status: undefined });
    return { id: row.id, text, complete: true };
  } catch (e) {
    if (signal.aborted) {
      await updateMessage(row.id, { content: text, status: "aborted" });
      return { id: row.id, text, complete: false };
    }
    await updateMessage(row.id, {
      content: text,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** Up to 4 questions the reader could ask next. Never fatal — chips are a bonus. */
async function attachFollowups(
  provider: Provider,
  messageId: string,
  asked: string,
  answer: string,
  signal: AbortSignal,
): Promise<void> {
  const settings = await readSettings();
  if (!settings.chatSuggestions || answer.length < 80) return;
  try {
    const reply = await llmCall(provider, {
      system: followupSystem(),
      messages: [
        { role: "user", content: `[Question]\n${asked}\n\n[Answer]\n${answer.slice(0, 4000)}` },
      ],
      json: true,
      temperature: 0.7,
      maxTokens: 400,
      signal,
    });
    const questions = parseFollowups(reply);
    if (questions.length) await updateMessage(messageId, { followups: questions });
  } catch {
    // A missing chip row is invisible; a failed turn is not.
  }
}

function parseFollowups(reply: string): string[] {
  const body = reply.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { q?: unknown; questions?: unknown })?.q ??
      (parsed as { questions?: unknown })?.questions);
  if (!Array.isArray(list)) return [];
  return [
    ...new Set(
      list
        .filter((q): q is string => typeof q === "string")
        .map((q) => q.trim())
        .filter((q) => q.length > 2 && q.length < 120),
    ),
  ].slice(0, 4);
}

/**
 * The semantic half of hybrid retrieval, when it is switched on and available.
 * Every failure here is reported and then ignored: a chat turn must never fail
 * because embeddings did.
 */
async function vectorFor(
  provider: Provider,
  index: RagIndex | undefined,
  question: string,
  signal: AbortSignal,
  onNotice?: (message: string) => void,
): Promise<RetrieveOptions["vector"]> {
  const settings = await readSettings();
  if (!settings.chatEmbeddingsEnabled || !index || !embeddingCapable(provider)) return undefined;
  try {
    const embeddings = await loadEmbeddings(index, settings.chatEmbeddingModel);
    if (!embeddings) return undefined;
    const queryVector = await embedQuery(provider, settings.chatEmbeddingModel, question, signal);
    return { embeddings, queryVector };
  } catch (e) {
    // The reader pressing Stop is not a degradation — reporting it as one would
    // claim vector search is broken every time a turn is cancelled.
    if (signal.aborted) throw e;
    onNotice?.(t("chat.embedFallback"));
    return undefined;
  }
}

export interface AskParams {
  doc: DocRecord;
  sessionId: string;
  question: string;
  quote?: ChatQuote;
  index?: RagIndex;
  signal: AbortSignal;
  handlers?: TurnHandlers;
}

export async function ask({
  doc,
  sessionId,
  question,
  quote,
  index,
  signal,
  handlers,
}: AskParams): Promise<void> {
  const provider = await pickChatProvider();
  const settings = await readSettings();
  const prior = await listMessages(sessionId);

  await appendMessage({ docId: doc.id, sessionId, role: "user", content: question, quote });

  // A question that carries no searchable term of its own is a follow-up, and a
  // follow-up belongs to the turn before it: it inherits that turn's selection
  // and keeps the passages the previous answer was built on. Questions that can
  // stand alone are retrieved fresh, so the topic can still move on.
  const followUp = isWeakQuery(index, question);
  const reversed = [...prior].reverse();
  const focus = quote ?? (followUp ? reversed.find((m) => m.quote)?.quote : undefined);
  const pinnedIds = followUp
    ? reversed.find((m) => m.role === "assistant" && m.chunkIds?.length)?.chunkIds
    : undefined;

  const query = expandQuery(index, question, prior);
  const context = retrieve(index, query, {
    k: settings.chatContextChunks,
    include: settings.chatIncludeContext,
    quote: focus,
    pinnedIds,
    vector: settings.chatIncludeContext
      ? await vectorFor(provider, index, query, signal, handlers?.onNotice)
      : undefined,
  });

  const messages: LlmMessage[] = [
    ...history(prior),
    {
      role: "user",
      content: composeTurn(question, formatPassages(context.chunks, true), context.mode, focus),
    },
  ];

  const result = await stream(
    provider,
    chatSystem(docFacts(doc)),
    messages,
    {
      docId: doc.id,
      sessionId,
      sources: context.pages.length ? context.pages : undefined,
      chunkIds: context.chunks.length ? context.chunks.map((c) => c.id) : undefined,
    },
    signal,
    handlers,
  );
  // Deliberately not awaited. The answer is already on screen, and keeping the
  // composer disabled through a second round-trip just to decorate it is worse
  // than the chips arriving a beat late. A late write lands on an older message,
  // where the panel renders no chips anyway.
  if (result.complete) void attachFollowups(provider, result.id, question, result.text, signal);
}

export interface SummaryParams {
  doc: DocRecord;
  sessionId: string;
  index: RagIndex;
  signal: AbortSignal;
  handlers?: TurnHandlers;
  /** Fires while a prompt is being generated for a language with no built-in. */
  onPreparingPrompt?: () => void;
}

export async function summarize({
  doc,
  sessionId,
  index,
  signal,
  handlers,
  onPreparingPrompt,
}: SummaryParams): Promise<void> {
  const provider = await pickChatProvider();
  const locale = getLocale();

  if (await needsGeneratedPrompt(locale)) {
    onPreparingPrompt?.();
    // A failed generation is not fatal: resolveSummaryPrompt falls back to English.
    await generateSummaryPrompt(provider, locale, signal).catch(() => {});
  }

  const { text: prompt } = await resolveSummaryPrompt(locale);
  const chunks = summaryContext(index);

  const result = await stream(
    provider,
    withDocFacts(prompt, docFacts(doc), locale),
    [{ role: "user", content: formatPassages(chunks, false) }],
    {
      docId: doc.id,
      sessionId,
      kind: "summary",
      sources: [...new Set(chunks.map((c) => c.pageNumber))].sort((a, b) => a - b),
      chunkIds: chunks.map((c) => c.id),
    },
    signal,
    handlers,
  );
  // The summary is where a reader has the least idea what to ask next, so the
  // chips matter more here than anywhere else. Still not awaited — see ask().
  if (result.complete) {
    void attachFollowups(provider, result.id, t("chat.summaryLabel"), result.text, signal);
  }
}
