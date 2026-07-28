import { t } from "@/i18n";
import { providerLabel } from "@/features/providers/store";
import type { Provider } from "@/types";

/** Rough cost-per-million tokens for common models (approximate, in USD). */
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 15, output: 75 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "Qwen/Qwen2.5-7B-Instruct": { input: 0.35, output: 0.4 },
  "mistral-small-latest": { input: 1, output: 3 },
  "grok-2-latest": { input: 2, output: 10 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gemini-3.6-flash": { input: 0.1, output: 0.4 },
  "deepseek-v4-flash-free": { input: 0, output: 0 },
  "glm-4-flash": { input: 0.1, output: 0.1 },
  "moonshot-v1-8k": { input: 0.12, output: 0.12 },
};

function rateFor(model: string): { input: number; output: number } {
  return MODEL_RATES[model] ?? { input: 2, output: 8 }; // fallback ~gpt-4o-ish
}

/** Embedding rates per 1M input tokens; there is no output side. */
const EMBEDDING_RATES: Record<string, number> = {
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
  "text-embedding-ada-002": 0.1,
};

/** What indexing a document with embeddings costs, as a display string. */
export function estimateEmbeddingCost(model: string, totalChars: number): string {
  const rate = EMBEDDING_RATES[model] ?? 0.05;
  const usd = ((totalChars / 4) * rate) / 1_000_000;
  if (usd === 0) return t("common.free");
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** Estimate total characters *across all pages* for a document. */
export interface CostEstimate {
  totalChars: number;
  totalPages: number;
  estimateInputTokens: number;
  estimateOutputTokens: number;
  providers: {
    name: string;
    model: string;
    costMin: string;
    costMax: string;
    free: boolean;
  }[];
}

/**
 * Estimate cost for a translation job without running it.
 * Input: ~4 chars/token for English, output similar. Rough ±50%.
 */
export function estimateCost(
  pagesToTranslate: number[],
  avgCharsPerPage: number,
  providers: Provider[],
): CostEstimate {
  const totalPages = pagesToTranslate.length;
  const totalChars = totalPages * (avgCharsPerPage || 3000);
  // Rough: 1 token ≈ 4 chars for input; output ~80% of input chars
  const estimateInputTokens = Math.round(totalChars / 4);
  const estimateOutputTokens = Math.round((totalChars * 0.8) / 4);

  return {
    totalChars,
    totalPages,
    estimateInputTokens,
    estimateOutputTokens,
    providers: providers.map((p) => {
      const rate = rateFor(p.model);
      if (rate.input === 0 && rate.output === 0) {
        return { name: providerLabel(p), model: p.model, costMin: t("common.free"), costMax: t("common.free"), free: true };
      }
      const min = (estimateInputTokens * rate.input + estimateOutputTokens * rate.output) / 1_000_000;
      const max = (estimateInputTokens * rate.input * 1.5 + estimateOutputTokens * rate.output * 1.5) / 1_000_000;
      return {
        name: p.name,
        model: p.model,
        costMin: `~$${min.toFixed(2)}`,
        costMax: `~$${max.toFixed(2)}`,
        free: false,
      };
    }),
  };
}
