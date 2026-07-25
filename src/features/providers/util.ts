import type { ReasoningLevel } from "@/types";

/**
 * Normalize an OpenAI-compatible base URL so endpoints resolve correctly.
 * If the path already ends in a version segment (/v1, /v4, /paas/v4 …) it is
 * kept; otherwise "/v1" is appended. This lets users enter bases with or
 * without the version (e.g. "https://opencode.ai/zen" -> ".../zen/v1").
 */
export function openaiBase(url: string): string {
  const base = url.trim().replace(/\/+$/, "");
  try {
    const path = new URL(base).pathname;
    if (/\/v\d+[a-z]*$/i.test(path)) return base;
  } catch {
    /* not a full URL — fall through */
  }
  return `${base}/v1`;
}

/** Approximate thinking-token budget per reasoning level (for Anthropic/Gemini). */
export function reasoningBudget(level: ReasoningLevel | undefined): number {
  switch (level) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 12000;
    default:
      return 0;
  }
}

export function reasoningEnabled(level: ReasoningLevel | undefined): boolean {
  return !!level && level !== "off";
}
