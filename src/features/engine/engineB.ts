import { db, readSettings } from "@/db/db";
import { t } from "@/i18n";
import type { LangCode, Provider } from "@/types";
import { listProviders } from "@/features/providers/store";
import { openaiBase } from "@/features/providers/util";
import { formatPageRange } from "@/features/import/pageRange";
import { getPdfHighlights, loadDocument } from "@/features/pdf/pdf";
import { parseCsv, resolveTermTarget, upsertAutoTerms } from "@/features/glossary/store";
import { filterTermPairs, noteTermWarning } from "@/features/glossary/extract";

export interface EngineBStatus {
  available: boolean;
  version?: string;
  babeldoc?: string;
  /** Capabilities the backend advertises; absent on backends predating them. */
  features?: string[];
}

/** A paragraph the translator gave up on — its source text survives in the PDF. */
interface FailedParagraph {
  id: string;
  text: string;
  error: string;
}

/** Per-run detail the backend parks for a single pickup after translating. */
interface RunReport {
  total: number;
  ok: number;
  fallback: number;
  filtered: number;
  failures: FailedParagraph[];
  glossary_csv: string | null;
}

/**
 * Probe the local backend's health. Checks the configured backend URL first,
 * then falls back to same-origin (for when the backend serves the SPA).
 * Results are cached in-memory for the session.
 */
let _status: EngineBStatus | null = null;
let _configUrl = "http://localhost:8787";

/** Set the backend URL to probe (called after settings load). */
export function setEngineBConfig(url: string): void {
  // Invalidate cache if URL changed
  if (url !== _configUrl) _status = null;
  _configUrl = url;
}

export async function probeEngineB(): Promise<EngineBStatus> {
  if (_status) return _status;

  // Try the configured URL first, then same-origin as fallback
  const urls = [
    `${_configUrl.replace(/\/$/, "")}/api/health`,
    "/api/health", // same-origin (when backend serves SPA)
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json();
      _status = { available: true, ...data };
      return _status!;
    } catch {
      continue;
    }
  }

  return (_status = { available: false });
}

export function getEngineBStatus(): EngineBStatus {
  return _status ?? { available: false };
}

/** Invalidate the cache (e.g. user changes the backend URL). */
export function resetEngineBProbe(): void {
  _status = null;
}

/** Health-check a specific backend URL. Returns true if reachable. */
export async function pingEngineB(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve the OpenAI-compatible provider BabelDOC should use. Prefers the
 * given id; otherwise the first enabled provider with an API key. BabelDOC
 * only speaks the OpenAI protocol, so non-openai kinds are skipped.
 */
async function resolveOpenAIProvider(preferredId: string | null) {
  const providers = await listProviders();
  const usable = providers.filter((p) => p.enabled && p.apiKey && p.kind === "openai");
  const chosen =
    (preferredId && usable.find((p) => p.id === preferredId)) || usable[0];
  return chosen ?? null;
}

/**
 * Name the paragraphs the translation actually lost, or undefined when it lost
 * none. BabelDOC returns a PDF and exit code 0 either way, so a real failure is
 * only visible as source text left sitting in the output.
 *
 * Says nothing about the `fallback` tally on purpose: those paragraphs were
 * declined by the batched stage and re-translated one at a time, so they are in
 * the PDF and translated. Counting them as losses accused the run of dropping
 * text the user could plainly see was present.
 */
function describeFailures(report: RunReport): string | undefined {
  const lost = report.failures.length + report.filtered;
  if (!lost) return undefined;
  const samples = report.failures
    .slice(0, 3)
    .map((f) => `· ${f.text.slice(0, 60)}${f.text.length > 60 ? "…" : ""} —— ${f.error}`);
  return [
    t("engineB.lostHeader", { total: report.total, lost }),
    ...samples,
    report.failures.length > 3 ? t("engineB.lostMore", { count: report.failures.length - 3 }) : "",
    report.filtered ? t("engineB.filtered", { count: report.filtered }) : "",
    t("engineB.lostAdvice"),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Collect the run report the backend parked for us. Null if it never arrived. */
async function fetchReport(reportId: string | null): Promise<RunReport | null> {
  if (!reportId) return null;
  try {
    const res = await fetch(`${_configUrl.replace(/\/$/, "")}/api/report/${reportId}`);
    return res.ok ? ((await res.json()) as RunReport) : null;
  } catch {
    return null;
  }
}

/**
 * File the glossary BabelDOC extracted during this run under the document's
 * glossary. BabelDOC extracts terms anyway to keep terminology consistent;
 * `--save-auto-extracted-glossary` is only what writes them out.
 */
async function importBabelDocGlossary(
  docId: string,
  docName: string,
  report: RunReport | null,
  provider: Provider,
): Promise<void> {
  try {
    if (!report) {
      throw new Error(
        getEngineBStatus().features?.includes("report")
          ? t("engineB.noReport")
          : t("engineB.backendOld"),
      );
    }
    // BabelDOC only writes the CSV when it actually found terms. The BOM it
    // writes would otherwise hide the header row from the parser, which then
    // imports "source,target" as a term.
    const pairs = parseCsv((report.glossary_csv ?? "").replace(/^﻿/, ""))
      .filter((p) => p.target)
      .map((p) => ({ source: p.source, target: p.target }));
    if (!pairs.length) {
      await noteTermWarning(docId, t("engineB.noTerms"));
      return;
    }
    // BabelDOC's extraction prompt is fixed and errs generous, so the user's
    // strictness setting has to be applied here rather than at extraction time.
    const strictness = (await readSettings()).termStrictness;
    const kept = await filterTermPairs(provider, pairs, strictness);
    await upsertAutoTerms(await resolveTermTarget(docId, docName), kept);
  } catch (e) {
    await noteTermWarning(docId, t("warn.termsFailed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

/** How often to ask the backend where a running translation has got to. */
const PROGRESS_POLL_MS = 1500;

/**
 * Mirror the backend's progress onto the document while the translate request
 * is in flight. BabelDOC runs as one long POST, so without this the bar sits at
 * 0% until the finished PDF lands and then jumps straight to 100%. Backends
 * predating the "progress" feature have nothing to report, so aren't polled.
 * Returns a function that stops the polling.
 */
function pollProgress(jobId: string, docId: string): () => void {
  let last = 0;
  const timer = setInterval(async () => {
    // Checked per tick, not once: the startup probe may still be in flight.
    if (!getEngineBStatus().features?.includes("progress")) return;
    try {
      const res = await fetch(`${_configUrl.replace(/\/$/, "")}/api/progress/${jobId}`);
      if (!res.ok) return; // 404 until the upload finishes and the run registers
      const { percent } = (await res.json()) as { percent: number };
      // Monotonic, and never a full 100% — the run isn't done until the PDF is
      // stored, which is this function's caller's job.
      last = Math.min(0.99, Math.max(last, percent / 100));
      await db.documents.update(docId, { progress: last });
    } catch {
      // A missed poll is not worth failing the translation over.
    }
  }, PROGRESS_POLL_MS);
  return () => clearInterval(timer);
}

export interface EngineBOptions {
  source: LangCode;
  target: LangCode;
  providerId: string | null;
  /** Keep BabelDOC's own term extraction on and file the result in a glossary. */
  autoExtract: boolean;
  signal?: AbortSignal;
}

/**
 * Translate a document using engine B (BabelDOC backend). Uploads the original
 * PDF plus the OpenAI-compatible provider config, then stores the returned
 * translated PDF bytes on the document for the reader to render.
 */
/**
 * Whether the document carries highlights flattened into the page content.
 * BabelDOC would re-emit those opaque fills over the translated text, so the
 * backend is asked to drop them — but only for documents that have them, since
 * the same BabelDOC option also removes decorative rules from paragraphs.
 * Samples the first few pages: a highlighted document has them early enough,
 * and parsing every page of a long PDF before the upload starts is not worth it.
 */
async function hasFlattenedHighlights(data: ArrayBuffer): Promise<boolean> {
  try {
    const pdf = await loadDocument(data);
    for (let n = 1; n <= Math.min(pdf.numPages, 8); n++) {
      if ((await getPdfHighlights(pdf, n)).length) return true;
    }
  } catch {
    // Not worth failing a translation over; the highlights just stay as they were.
  }
  return false;
}

export async function translateWithEngineB(docId: string, opts: EngineBOptions): Promise<void> {
  const { source, target, providerId, signal } = opts;
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error(t("error.docNotFound"));

  const provider = await resolveOpenAIProvider(providerId);
  if (!provider) {
    await db.documents.update(docId, {
      status: "error",
      error: t("engineB.noOpenAI"),
    });
    throw new Error("no openai-compatible provider");
  }

  await db.documents.update(docId, {
    status: "translating",
    progress: 0,
    error: undefined,
    warning: undefined,
  });

  const jobId = crypto.randomUUID();
  const stopPolling = pollProgress(jobId, docId);
  try {
    const form = new FormData();
    form.append("file", new Blob([doc.data], { type: "application/pdf" }), doc.name);
    form.append("source", source);
    form.append("target", target);
    form.append("job_id", jobId);
    // Honour the page selection made at import time — without this BabelDOC
    // translates the whole document regardless of what the user picked.
    if (doc.selectedPages?.length) form.append("pages", formatPageRange(doc.selectedPages));
    form.append("thinking", (provider.reasoning ?? "off") === "off" ? "disabled" : "enabled");
    form.append("auto_glossary", opts.autoExtract ? "on" : "off");
    form.append("openai_base_url", openaiBase(provider.baseURL));
    form.append("openai_api_key", provider.apiKey);
    form.append("openai_model", provider.model);
    if (await hasFlattenedHighlights(doc.data)) form.append("strip_highlights", "on");

    const res = await fetch(`${_configUrl.replace(/\/$/, "")}/api/translate`, {
      method: "POST",
      body: form,
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? t("engineB.backendError", { status: res.status }));
    }

    const reportId = res.headers.get("X-Report-Id");
    const translatedData = await res.arrayBuffer();
    const report = await fetchReport(reportId);
    await db.documents.update(docId, {
      translatedData,
      status: "translated",
      progress: 1,
      updatedAt: Date.now(),
      warning: report ? describeFailures(report) : undefined,
    });

    // BabelDOC extracts terms as part of translating; file them afterwards so
    // a hiccup here can't discard an otherwise finished PDF.
    if (opts.autoExtract) await importBabelDocGlossary(docId, doc.name, report, provider);
  } catch (e) {
    await db.documents.update(docId, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  } finally {
    stopPolling();
  }
}
