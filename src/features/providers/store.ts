import { db } from "@/db/db";
import { t, tDynamic } from "@/i18n";
import type { Provider } from "@/types";
import { presetName, type ProviderPreset } from "./presets";

export const GOOGLE_FREE: Provider = {
  id: "__google_free__",
  // Synthesised, never persisted — display goes through providerLabel().
  name: "Google Translate",
  kind: "google-free",
  baseURL: "",
  apiKey: "",
  model: "",
  enabled: true,
  order: 9999,
};

/**
 * Display name. App-supplied defaults ("Custom (OpenAI-compatible)", "Untitled
 * provider") are stored as a key so they follow the UI language; a name the
 * user typed is returned verbatim.
 */
export function providerLabel(p: Provider): string {
  if (p.kind === "google-free") return t("provider.googleFree");
  return (p.nameKey && tDynamic(p.nameKey)) || p.name;
}

/** Build an unsaved Provider from a preset (used to seed the add form). */
export function makeProvider(preset: ProviderPreset, order: number): Provider {
  return {
    id: crypto.randomUUID(),
    name: presetName(preset),
    nameKey: preset.nameKey,
    kind: preset.kind,
    baseURL: preset.baseURL,
    apiKey: "",
    model: preset.model,
    enabled: true,
    order,
    reasoning: "off",
  };
}

export async function nextOrder(): Promise<number> {
  return await db.providers.count();
}

/** Insert or update a full provider record. */
export async function upsertProvider(provider: Provider): Promise<void> {
  await db.providers.put(provider);
}

export async function updateProvider(id: string, patch: Partial<Provider>): Promise<void> {
  await db.providers.update(id, patch);
}

export async function deleteProvider(id: string): Promise<void> {
  await db.providers.delete(id);
}

export async function listProviders(): Promise<Provider[]> {
  const all = await db.providers.toArray();
  return all.sort((a, b) => a.order - b.order);
}

/**
 * Build the ordered fallback chain: the chosen provider first (if any),
 * then the other enabled providers, then the free Google fallback.
 */
export async function buildChain(
  preferredId: string | null,
  googleFallback: boolean,
): Promise<Provider[]> {
  const enabled = (await listProviders()).filter((p) => p.enabled && p.apiKey);
  const chain: Provider[] = [];
  if (preferredId) {
    const pref = enabled.find((p) => p.id === preferredId);
    if (pref) chain.push(pref);
  }
  for (const p of enabled) if (!chain.includes(p)) chain.push(p);
  if (googleFallback) chain.push(GOOGLE_FREE);
  return chain;
}
