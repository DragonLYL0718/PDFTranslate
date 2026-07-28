import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { History, Loader2, MessageSquarePlus, Settings, Sparkles, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { useSettings } from "@/store/useSettings";
import type { ChatMessage, DocRecord, ChatQuote, RagIndex } from "@/types";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageView } from "./ChatMessageView";
import { PromptSettings } from "./PromptSettings";
import { SessionMenu } from "./SessionMenu";
import { approxTokens, formatPassages } from "./context";
import {
  createSession,
  deleteMessage,
  deleteSession,
  listMessages,
  listSessions,
  setSummaryState,
} from "./chatStore";
import { patchSettings } from "@/db/db";
import { dropIndex, ensureIndex, getIndex, type BuildProgress } from "./ragStore";
import { ask, summarize, type TurnHandlers } from "./runChat";
import { estimateEmbeddingCost } from "@/features/engine/costEstimate";

/** Where a citation points. `blockIds` is empty when only the page is known. */
export interface CiteTarget {
  page: number;
  blockIds?: string[];
}

/**
 * Module scope on purpose. React remounts this panel with the same prop still
 * set — StrictMode does it on every mount in development, and switching panels
 * does it in production — and a component-local ref would be recreated, firing
 * the canned question a second time and leaving an aborted turn in the history.
 */
const handledAsks = new Set<string>();

interface Props {
  doc: DocRecord;
  /** A passage selected on the page, waiting to be asked about. */
  quote?: ChatQuote;
  onClearQuote: () => void;
  /** Scroll the reader to the passage a citation points at. */
  onCite?: (target: CiteTarget) => void;
  /** A question to send immediately — set by the page's "explain this" action. */
  pendingAsk?: { id: string; question: string } | null;
  onPendingAskConsumed?: () => void;
  onClose: () => void;
}

export function ChatPanel({
  doc,
  quote,
  onClearQuote,
  onCite,
  pendingAsk,
  onPendingAskConsumed,
  onClose,
}: Props) {
  const settings = useSettings();
  // No default value: `undefined` means "still loading", which the resolver below
  // needs to distinguish from "this document has no conversations yet".
  const sessions = useLiveQuery(() => listSessions(doc.id), [doc.id]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messages =
    useLiveQuery(() => (sessionId ? listMessages(sessionId) : Promise.resolve([])), [sessionId], []) ??
    [];

  const [index, setIndex] = useState<RagIndex | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [preparingPrompt, setPreparingPrompt] = useState(false);
  const [live, setLive] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Something degraded but the turn still worked (e.g. vectors unavailable). */
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Live width while the edge is being dragged; null when not resizing. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingText = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  /** The document whose session choice has already been made. */
  const resolvedFor = useRef<string | null>(null);

  useEffect(() => {
    getIndex(doc.id).then((i) => setIndex(i ?? null));
  }, [doc.id]);

  // Open on the most recent conversation, once. Resolving only once per document
  // is what lets "new conversation" leave sessionId null without this snapping
  // straight back to the previous one.
  useEffect(() => {
    if (resolvedFor.current === doc.id) return;
    if (!sessions) return;
    resolvedFor.current = doc.id;
    setSessionId(sessions[0]?.id ?? null);
  }, [sessions, doc.id]);

  // A fast provider emits hundreds of deltas a second; repaint at most once a frame.
  const pushDelta = useCallback((text: string) => {
    pendingText.current = text;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const next = pendingText.current;
      if (next !== null) setLive((l) => (l ? { ...l, text: next } : l));
    });
  }, []);

  // Only the pending repaint is dropped on unmount. An in-flight turn is left to
  // finish and persist: closing the panel shouldn't throw away a reply that has
  // already been paid for, and aborting here also killed the turn outright under
  // React's development mount/unmount/mount cycle.
  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  // Hand rendering back to the persisted row only once it has actually landed,
  // otherwise the reply blinks empty between the last delta and the write.
  useEffect(() => {
    if (!live) return;
    const row = messages.find((m) => m.id === live.id);
    if (row && row.status !== "streaming") setLive(null);
  }, [messages, live]);

  // Follow the stream, unless the reader scrolled up to re-read something.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  const handlers: TurnHandlers = {
    onAssistant: (id) => setLive({ id, text: "" }),
    onDelta: pushDelta,
    onNotice: setNotice,
  };

  async function run(fn: (signal: AbortSignal) => Promise<void>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await fn(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abort.current = null;
      setBusy(false);
      setPreparingPrompt(false);
      setProgress(null);
    }
  }

  async function ensureReady(): Promise<RagIndex> {
    if (index) return index;
    const built = await ensureIndex(doc.id, { onProgress: setProgress, onNotice: setNotice });
    setIndex(built);
    return built;
  }

  /** The conversation to write into, created on the first turn rather than on open. */
  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const created = await createSession(doc.id);
    setSessionId(created.id);
    return created.id;
  }

  function startSummary() {
    run(async (signal) => {
      const [built, session] = [await ensureReady(), await ensureSession()];
      await summarize({
        doc,
        sessionId: session,
        index: built,
        signal,
        handlers,
        onPreparingPrompt: () => setPreparingPrompt(true),
      });
      await setSummaryState(doc.id, "done");
    });
  }

  function skipSummary() {
    run(async () => {
      await ensureReady();
      await setSummaryState(doc.id, "skipped");
    });
  }

  function send(question: string) {
    const attached = quote;
    onClearQuote();
    run(async (signal) => {
      const built = await ensureReady();
      const session = await ensureSession();
      await ask({ doc, sessionId: session, question, quote: attached, index: built, signal, handlers });
    });
  }

  // The page's "explain this" action opens the panel with both a quote and a
  // canned question. Consuming it clears the prop, so this can't loop.
  useEffect(() => {
    if (!pendingAsk || busy || handledAsks.has(pendingAsk.id)) return;
    handledAsks.add(pendingAsk.id);
    onPendingAskConsumed?.();
    send(pendingAsk.question);
  }, [pendingAsk, busy]);

  function regenerate(assistantId: string) {
    const at = messages.findIndex((m) => m.id === assistantId);
    if (at < 0 || !sessionId) return;
    const target = messages[at];
    const question = messages
      .slice(0, at)
      .reverse()
      .find((m) => m.role === "user");

    run(async (signal) => {
      await deleteMessage(assistantId);
      const built = await ensureReady();
      if (target.kind === "summary") {
        await summarize({ doc, sessionId, index: built, signal, handlers });
        return;
      }
      if (!question) return;
      // ask() re-appends the question, so drop the old copy first.
      await deleteMessage(question.id);
      await ask({
        doc,
        sessionId,
        question: question.content,
        quote: question.quote,
        index: built,
        signal,
        handlers,
      });
    });
  }

  async function rebuildIndex() {
    setSettingsOpen(false);
    setIndex(null);
    await dropIndex(doc.id);
    run(async () => {
      setIndex(await ensureIndex(doc.id, { onProgress: setProgress }));
    });
  }

  /** Park the current conversation and start a fresh one. Nothing is deleted. */
  function newSession() {
    setHistoryOpen(false);
    setSessionId(null);
    setLive(null);
    setError(null);
    setNotice(null);
  }

  function switchSession(id: string) {
    setHistoryOpen(false);
    setSessionId(id);
    setLive(null);
    setError(null);
  }

  async function removeSession(id: string) {
    if (!confirm(t("chat.clearConfirm"))) return;
    await deleteSession(id);
    if (id !== sessionId) return;
    setHistoryOpen(false);
    setLive(null);
    setError(null);
    // Fall through to the next most recent rather than to an empty panel.
    setSessionId((sessions ?? []).find((s) => s.id !== id)?.id ?? null);
  }

  /**
   * A citation resolves against the chunks that answer was actually given, so it
   * can never point at a paragraph the model never saw. Falls back to the page
   * when the document has no block-level text (engine B).
   */
  const citeFrom = useCallback(
    (message: ChatMessage, page: number) => {
      if (!onCite) return;
      const ids = new Set(message.chunkIds ?? []);
      const blockIds = (index?.chunks ?? [])
        .filter((c) => c.pageNumber === page && ids.has(c.id))
        .flatMap((c) => c.blockIds ?? []);
      onCite({ page, blockIds });
    },
    [onCite, index],
  );

  const contextTokens =
    index && settings.chatIncludeContext
      ? approxTokens(formatPassages(index.chunks.slice(0, settings.chatContextChunks), true))
      : 0;

  const showStartCard = !doc.chatSummary && messages.length === 0;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <aside
      data-chat
      className="relative flex h-full shrink-0 flex-col border-l border-border-subtle bg-surface-1"
      style={{ width: dragWidth ?? settings.chatPanelWidth }}
    >
      {/* Drag the left edge to resize; committed to settings on release. */}
      <div
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent-soft"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragWidth(settings.chatPanelWidth);
        }}
        onPointerMove={(e) => {
          if (dragWidth === null) return;
          setDragWidth(Math.min(720, Math.max(320, window.innerWidth - e.clientX)));
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (dragWidth !== null) patchSettings({ chatPanelWidth: Math.round(dragWidth) });
          setDragWidth(null);
        }}
      />
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-3">
        <div className="min-w-0 truncate pl-1 font-semibold tracking-tight">{t("chat.title")}</div>
        <div className="relative flex shrink-0 items-center gap-1">
          <button
            onClick={newSession}
            disabled={!sessionId || busy}
            className="rounded-control p-1 text-text-3 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
            title={t("chat.newSession")}
          >
            <MessageSquarePlus className="size-4" />
          </button>
          <button
            onClick={() => {
              setSettingsOpen(false);
              setHistoryOpen((v) => !v);
            }}
            className={cn(
              "rounded-control p-1 hover:bg-surface-2",
              historyOpen ? "text-accent" : "text-text-3",
            )}
            title={t("chat.history")}
          >
            <History className="size-4" />
          </button>
          <button
            onClick={() => {
              setHistoryOpen(false);
              setSettingsOpen((v) => !v);
            }}
            className={cn(
              "rounded-control p-1 hover:bg-surface-2",
              settingsOpen ? "text-accent" : "text-text-3",
            )}
            title={t("chat.settings")}
          >
            <Settings className="size-4" />
          </button>
          <button
            onClick={onClose}
            className="rounded-control p-1 text-text-3 hover:bg-surface-2"
            title={t("chat.close")}
          >
            <X className="size-4" />
          </button>
          {historyOpen && (
            <SessionMenu
              sessions={sessions ?? []}
              activeId={sessionId}
              onPick={switchSession}
              onDelete={removeSession}
              onClose={() => setHistoryOpen(false)}
            />
          )}
          {settingsOpen && (
            <PromptSettings
              index={index}
              onRebuild={rebuildIndex}
              onRegenerateSummary={
                doc.chatSummary === "done"
                  ? () => {
                      setSettingsOpen(false);
                      const summary = messages.find((m) => m.kind === "summary");
                      if (summary) regenerate(summary.id);
                      else startSummary();
                    }
                  : undefined
              }
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2 pretty-scrollbar">
        {showStartCard && (
          <div className={cn(styles.card, "mx-3 my-2 flex flex-col gap-2 p-4")}>
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="size-4 text-accent" /> {t("chat.start.title")}
            </div>
            <p className={styles.muted}>{t("chat.start.body", { pages: doc.pageCount })}</p>
            {settings.chatEmbeddingsEnabled && (
              <p className={styles.muted}>
                {t("chat.start.embedCost", {
                  cost: estimateEmbeddingCost(settings.chatEmbeddingModel, doc.pageCount * 3000),
                })}
              </p>
            )}
            {busy ? (
              <div className="flex items-center gap-2 text-sm text-text-3">
                <Loader2 className="size-4 animate-spin" />
                {preparingPrompt ? t("chat.start.preparingPrompt") : progressLabel(progress)}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button className={cn(styles.button, styles.press, "px-3 py-1.5")} onClick={startSummary}>
                  {t("chat.start.summarize")}
                </button>
                <button
                  className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5")}
                  onClick={skipSummary}
                >
                  {t("chat.start.skip")}
                </button>
              </div>
            )}
          </div>
        )}

        {!showStartCard && messages.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-text-3">{t("chat.empty")}</p>
        )}

        {messages.map((m) => (
          <ChatMessageView
            key={m.id}
            message={m}
            live={live?.id === m.id ? live.text : undefined}
            onCite={onCite ? (page) => citeFrom(m, page) : undefined}
            onAsk={!busy && m.id === lastAssistant?.id ? send : undefined}
            onRegenerate={
              m.role === "assistant" && m.id === lastAssistant?.id && !busy
                ? () => regenerate(m.id)
                : undefined
            }
          />
        ))}

        {busy && !showStartCard && !live && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-text-3">
            <Loader2 className="size-4 animate-spin" />
            {progressLabel(progress)}
          </div>
        )}

        {notice && (
          <div className="mx-3 my-2 rounded-control bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
            {notice}
          </div>
        )}

        {error && (
          <div className="mx-3 my-2 rounded-control bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
            {error === t("chat.needProvider") && (
              <Link to="/settings" className="ml-2 underline">
                {t("chat.goSettings")}
              </Link>
            )}
          </div>
        )}
      </div>

      <ChatComposer
        quote={quote}
        onClearQuote={onClearQuote}
        onSend={send}
        onStop={() => abort.current?.abort()}
        busy={busy}
        contextTokens={contextTokens}
      />
    </aside>
  );
}

function progressLabel(progress: BuildProgress | null): string {
  if (progress?.phase === "extract") {
    return t("chat.start.extracting", { done: progress.done, total: progress.total });
  }
  if (progress?.phase === "embed") {
    return t("chat.start.embedding", { done: progress.done, total: progress.total });
  }
  return t("chat.start.chunking");
}
