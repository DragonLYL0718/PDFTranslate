import { t } from "@/i18n";
import type { Provider } from "@/types";
import { openaiBase } from "./util";
import { smartFetch } from "./net";

/**
 * Fetch the available model list for a provider (cc-switch style).
 * Requires a valid baseURL + key. May be CORS-blocked in-browser for some
 * providers — callers should keep manual model entry as a fallback.
 */
export async function fetchModels(provider: Provider): Promise<string[]> {
  const base = provider.baseURL.replace(/\/$/, "");

  if (provider.kind === "anthropic") {
    const res = await smartFetch(`${base}/v1/models?limit=1000`, {
      headers: {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!res.ok) throw new Error(t("provider.fetchFailedStatus", { status: res.status }));
    const json = await res.json();
    return (json.data ?? []).map((m: { id: string }) => m.id);
  }

  if (provider.kind === "gemini") {
    // Key in a header, not the query string — see the note in translate.ts.
    const res = await smartFetch(`${base}/v1beta/models?pageSize=1000`, {
      headers: { "x-goog-api-key": provider.apiKey },
    });
    if (!res.ok) throw new Error(t("provider.fetchFailedStatus", { status: res.status }));
    const json = await res.json();
    return (json.models ?? [])
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      .filter((n: string) => n.includes("gemini"));
  }

  if (provider.kind === "google-free") return [];

  // OpenAI-compatible (normalize base so ".../zen" -> ".../zen/v1/models")
  const res = await smartFetch(`${openaiBase(provider.baseURL)}/models`, {
    headers: { authorization: `Bearer ${provider.apiKey}` },
  });
  if (!res.ok) throw new Error(t("provider.fetchFailedStatus", { status: res.status }));
  const json = await res.json();
  return (json.data ?? [])
    .map((m: { id: string }) => m.id)
    .sort((a: string, b: string) => a.localeCompare(b));
}
