import { db } from "@/db/db";
import { t } from "@/i18n";
import type { LangCode, Provider } from "@/types";
import { ProxyUnavailableError } from "@/features/providers/net";
import { useProxyDialog } from "@/store/proxyDialog";
import { buildChain } from "@/features/providers/store";
import { loadDocument, extractPage } from "@/features/pdf/pdf";
import { pagesToTranslate } from "@/features/import/pageRange";
import { detectLang } from "@/features/import/languages";
import { translatePage, type RunOptions } from "./engineA";
import { getInjectionTerms } from "@/features/glossary/store";
import { extractAndSaveTerms, noteTermWarning } from "@/features/glossary/extract";

export interface JobOptions {
  providerId: string | null;
  googleFallback: boolean;
  memoryEnabled: boolean;
  autoExtract: boolean;
  /** Skip the memory read so an explicit re-run really re-translates. Still writes back. */
  forceFresh?: boolean;
  signal?: AbortSignal;
}

/** Translate a stored document page-by-page, persisting progress as it goes. */
export async function runTranslationJob(docId: string, opts: JobOptions): Promise<void> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error(t("error.docNotFound"));

  const chain = await buildChain(opts.providerId, opts.googleFallback);
  if (!chain.length) throw new Error(t("error.noProviders"));

  await db.documents.update(docId, {
    status: "translating",
    progress: 0,
    error: undefined,
    warning: undefined,
  });

  try {
    const pdf = await loadDocument(doc.data);
    const pages = pagesToTranslate(doc.selectedPages, doc.pageCount);

    // Resolve source language if auto.
    let source: LangCode = doc.sourceLang;
    if (source === "auto") {
      const first = await extractPage(pdf, pages[0]);
      const detected = detectLang(first.blocks.map((b) => b.text).join(" "));
      source = detected;
      await db.documents.update(docId, { detectedLang: detected });
    }

    const runOpts: RunOptions = {
      docId,
      source,
      target: doc.targetLang,
      chain,
      glossary: await getInjectionTerms(docId),
      useMemory: opts.memoryEnabled,
      forceFresh: opts.forceFresh,
      signal: opts.signal,
    };

    let lastWrite = 0;
    for (let idx = 0; idx < pages.length; idx++) {
      if (opts.signal?.aborted) {
        await db.documents.update(docId, { status: "ready" });
        return;
      }
      const docPage = await translatePage(pdf, pages[idx], runOpts, (frac) => {
        // Sub-page progress so a single slow page doesn't sit at 0%. Throttle writes.
        const now = Date.now();
        if (now - lastWrite > 300) {
          lastWrite = now;
          db.documents.update(docId, { progress: (idx + frac) / pages.length });
        }
      });
      await db.pages.put(docPage);
      await db.documents.update(docId, {
        progress: (idx + 1) / pages.length,
        updatedAt: Date.now(),
      });
    }

    await db.documents.update(docId, { status: "translated", progress: 1, updatedAt: Date.now() });

    // Auto-extract proper nouns into the document's glossary. Best-effort — the
    // translation itself succeeded — but surfaced as a warning rather than
    // swallowed, so an empty glossary always comes with a reason.
    if (opts.autoExtract) {
      await extractTerms(docId, doc.name, source, doc.targetLang, chain, opts.signal);
    }
  } catch (e) {
    await db.documents.update(docId, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    maybePromptRelay(e);
    throw e;
  }
}

/**
 * Extract terms into the document's glossary without failing the translation.
 * A "0 terms" result is as worth reporting as an error: both leave the user
 * staring at an unchanged glossary.
 */
export async function extractTerms(
  docId: string,
  docName: string,
  source: LangCode,
  target: LangCode,
  chain: Provider[],
  signal?: AbortSignal,
): Promise<void> {
  try {
    const n = await extractAndSaveTerms(docId, docName, source, target, chain, signal);
    if (!n) await noteTermWarning(docId, t("warn.termsEmpty"));
  } catch (e) {
    await noteTermWarning(docId, t("warn.termsFailed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * When a job fails because the provider is unreachable (CORS block) or the
 * request timed out, surface the local-relay setup dialog with the likely
 * causes so the user can start the service instead of just seeing an error.
 */
function maybePromptRelay(e: unknown): void {
  const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
  if (!(e instanceof ProxyUnavailableError) && !isTimeout) return;
  useProxyDialog.getState().show(
    t("error.requestFailed"),
  );
}
