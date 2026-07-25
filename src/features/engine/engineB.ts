import { db } from "@/db/db";
import type { LangCode } from "@/types";
import { listProviders } from "@/features/providers/store";
import { openaiBase } from "@/features/providers/util";
import { formatPageRange } from "@/features/import/pageRange";

export interface EngineBStatus {
  available: boolean;
  version?: string;
  babeldoc?: string;
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
 * Turn the backend's paragraph tally into a user-facing warning, or undefined
 * when everything translated cleanly. BabelDOC returns a PDF and exit code 0
 * even when the model failed on half the paragraphs — those come back blank,
 * which looks like a layout bug rather than a translation failure.
 */
function describeStats(header: string | null): string | undefined {
  if (!header) return undefined;
  const n = (k: string) => Number(header.match(new RegExp(`${k}=(\\d+)`))?.[1] ?? 0);
  const [total, ok] = [n("total"), n("ok")];
  if (!total || ok === total) return undefined;
  return (
    `${total} 个段落中有 ${total - ok} 个未能正常翻译，译文里这些段落会缺失或保留原文。` +
    `常见原因是模型报错或触发限流：可在设置中把该提供商的「推理强度」设为关闭，` +
    `或启动后端前设置环境变量 BABELDOC_QPS=1 降低并发，然后重新翻译。`
  );
}

/**
 * Translate a document using engine B (BabelDOC backend). Uploads the original
 * PDF plus the OpenAI-compatible provider config, then stores the returned
 * translated PDF bytes on the document for the reader to render.
 */
export async function translateWithEngineB(
  docId: string,
  source: LangCode,
  target: LangCode,
  providerId: string | null,
  signal?: AbortSignal,
): Promise<void> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error("文档不存在");

  const provider = await resolveOpenAIProvider(providerId);
  if (!provider) {
    await db.documents.update(docId, {
      status: "error",
      error: "未找到可用的 OpenAI 兼容提供商，请先在设置中添加一个（含 API Key）。",
    });
    throw new Error("no openai-compatible provider");
  }

  await db.documents.update(docId, {
    status: "translating",
    progress: 0,
    error: undefined,
    warning: undefined,
  });

  try {
    const form = new FormData();
    form.append("file", new Blob([doc.data], { type: "application/pdf" }), doc.name);
    form.append("source", source);
    form.append("target", target);
    // Honour the page selection made at import time — without this BabelDOC
    // translates the whole document regardless of what the user picked.
    if (doc.selectedPages?.length) form.append("pages", formatPageRange(doc.selectedPages));
    form.append("thinking", (provider.reasoning ?? "off") === "off" ? "disabled" : "enabled");
    form.append("openai_base_url", openaiBase(provider.baseURL));
    form.append("openai_api_key", provider.apiKey);
    form.append("openai_model", provider.model);

    const res = await fetch(`${_configUrl.replace(/\/$/, "")}/api/translate`, {
      method: "POST",
      body: form,
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `后端错误 ${res.status}`);
    }

    const warning = describeStats(res.headers.get("X-Translate-Stats"));
    const translatedData = await res.arrayBuffer();
    await db.documents.update(docId, {
      translatedData,
      status: "translated",
      progress: 1,
      updatedAt: Date.now(),
      warning,
    });
  } catch (e) {
    await db.documents.update(docId, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
