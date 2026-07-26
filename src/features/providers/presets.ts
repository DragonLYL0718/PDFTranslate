import { t, type PlainKey } from "@/i18n";
import type { ProviderKind } from "@/types";

export interface ProviderPreset {
  key: string;
  /** Vendor name, shown as-is. Presets that aren't a brand carry `nameKey` instead. */
  name: string;
  /** Set when the label is descriptive rather than a brand, e.g. "Custom (OpenAI-compatible)". */
  nameKey?: PlainKey;
  kind: ProviderKind;
  baseURL: string;
  model: string;
  /** Where to get an API key (shown as a hint). */
  keyHint?: string;
}

/**
 * Resolve a preset's display name. Not baked into the array: this module is
 * evaluated at import time, before initI18n() has picked the locale.
 */
export function presetName(preset: ProviderPreset): string {
  return preset.nameKey ? t(preset.nameKey) : preset.name;
}

// cc-switch-style presets. Users pick one, fill in their key, and can edit any field.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { key: "openai", name: "OpenAI", kind: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { key: "anthropic", name: "Anthropic Claude", kind: "anthropic", baseURL: "https://api.anthropic.com", model: "claude-haiku-4-5-20251001" },
  { key: "gemini", name: "Google Gemini", kind: "gemini", baseURL: "https://generativelanguage.googleapis.com", model: "gemini-2.0-flash" },
  { key: "deepseek", name: "DeepSeek", kind: "openai", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { key: "siliconflow", name: "硅基流动 SiliconFlow", kind: "openai", baseURL: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
  { key: "openrouter", name: "OpenRouter", kind: "openai", baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { key: "moonshot", name: "Moonshot / Kimi", kind: "openai", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { key: "zhipu", name: "智谱 GLM", kind: "openai", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { key: "groq", name: "Groq", kind: "openai", baseURL: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { key: "mistral", name: "Mistral", kind: "openai", baseURL: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { key: "xai", name: "xAI Grok", kind: "openai", baseURL: "https://api.x.ai/v1", model: "grok-2-latest" },
  { key: "ollama", name: "Ollama", nameKey: "preset.local", kind: "openai", baseURL: "http://localhost:11434/v1", model: "qwen2.5" },
  { key: "custom", name: "Custom", nameKey: "preset.custom", kind: "openai", baseURL: "https://", model: "" },
];
