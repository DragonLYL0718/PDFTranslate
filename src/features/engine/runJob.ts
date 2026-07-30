import { db } from "@/db/db";
import { t } from "@/i18n";
import type { LangCode, Provider } from "@/types";
import { ProxyUnavailableError } from "@/features/providers/net";
import { useProxyDialog } from "@/store/proxyDialog";
import { isDesktop } from "@/platform";
import { buildChain } from "@/features/providers/store";
import { loadDocument, extractPage } from "@/features/pdf/pdf";
import { pagesToTranslate } from "@/features/import/pageRange";
import { detectLang } from "@/features/import/languages";
import { planPage, runPagePlan, type PagePlan, type RunOptions } from "./engineA";
import { getInjectionTerms } from "@/features/glossary/store";
import { extractAndSaveTerms, noteTermWarning } from "@/features/glossary/extract";

/**
 * Share of the bar given to extracting and planning the pages. Text extraction
 * is fast per page but not free over a long PDF, and it all happens before the
 * first provider call — without its own slice the bar would sit at 0% through it.
 */
const PLAN_SHARE = 0.1;

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
    /** Throttled, because every write re-reads the document (PDF bytes and all). */
    const report = (progress: number) => {
      const now = Date.now();
      if (now - lastWrite < 300) return;
      lastWrite = now;
      void db.documents.update(docId, { progress });
    };

    // Extract and plan every page before translating any of it: the batch is
    // the only unit that takes real time, and totalling them up front is what
    // lets the bar move steadily instead of jumping a whole page at a time.
    const plans: PagePlan[] = [];
    for (const pageNumber of pages) {
      if (opts.signal?.aborted) {
        await db.documents.update(docId, { status: "ready" });
        return;
      }
      plans.push(await planPage(pdf, pageNumber, runOpts));
      report((plans.length / pages.length) * PLAN_SHARE);
    }

    const totalBatches = plans.reduce((n, p) => n + p.batchCount, 0);
    let doneBatches = 0;
    let donePages = 0;
    // A run served entirely from the translation memory has no batches to
    // count, so fall back to pages rather than dividing by zero.
    const translated = () =>
      totalBatches ? doneBatches / totalBatches : donePages / pages.length;

    for (const plan of plans) {
      if (opts.signal?.aborted) {
        await db.documents.update(docId, { status: "ready" });
        return;
      }
      const docPage = await runPagePlan(plan, runOpts, () => {
        doneBatches++;
        report(PLAN_SHARE + (1 - PLAN_SHARE) * translated());
      });
      await db.pages.put(docPage);
      donePages++;
      await db.documents.update(docId, {
        progress: PLAN_SHARE + (1 - PLAN_SHARE) * translated(),
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
  if (isDesktop) return; // native HTTP needs no relay, so the dialog is nonsense there
  const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
  if (!(e instanceof ProxyUnavailableError) && !isTimeout) return;
  useProxyDialog.getState().show(
    t("error.requestFailed"),
  );
}
