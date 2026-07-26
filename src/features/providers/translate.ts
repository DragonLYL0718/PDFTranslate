import { t } from "@/i18n";
import type { LangCode, Provider } from "@/types";
import { langPromptName } from "@/features/import/languages";
import { openaiBase, reasoningBudget, reasoningEnabled } from "./util";
import { smartFetch, withTimeout } from "./net";

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface TranslateParams {
  source: LangCode; // "auto" allowed
  target: LangCode;
  glossary?: GlossaryEntry[];
  signal?: AbortSignal;
}

/** Translate a batch of text segments, returning one translation per input. */
export async function translateSegments(
  provider: Provider,
  segments: string[],
  params: TranslateParams,
): Promise<string[]> {
  if (segments.length === 0) return [];
  // Bound each request so a stalled provider surfaces as an error, not a hang.
  const p = { ...params, signal: withTimeout(params.signal, 120_000) };
  if (provider.kind === "google-free") {
    return await googleTranslate(segments, p);
  }
  return await llmTranslate(provider, segments, p);
}

// ---------------------------------------------------------------------------
// LLM providers (OpenAI-compatible / Anthropic / Gemini)
// ---------------------------------------------------------------------------

function buildSystemPrompt(source: LangCode, target: LangCode, glossary?: GlossaryEntry[]): string {
  const lines = [
    `You are a professional document translator. Translate each segment from ${langPromptName(source)} into ${langPromptName(target)}.`,
    "Rules:",
    "- Preserve meaning, tone, numbers, punctuation and inline formatting.",
    "- Do NOT translate code, URLs, math formulas or proper nouns that have no standard translation.",
    "- Keep terminology consistent across segments.",
    "- Return ONLY a JSON object of the form {\"t\":[\"...\",\"...\"]} with exactly one translated string per input segment, in the same order. No commentary.",
  ];
  if (glossary?.length) {
    lines.push("Glossary (use these exact translations):");
    for (const g of glossary.slice(0, 200)) lines.push(`- ${g.source} => ${g.target}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(segments: string[]): string {
  const payload = segments.map((s, i) => ({ i, text: s }));
  return "Translate these segments:\n" + JSON.stringify(payload);
}

async function llmTranslate(
  provider: Provider,
  segments: string[],
  params: TranslateParams,
): Promise<string[]> {
  const system = buildSystemPrompt(params.source, params.target, params.glossary);
  const user = buildUserPrompt(segments);
  const raw = await callLLM(provider, system, user, params.signal);
  const parsed = parseTranslations(raw, segments.length);
  return parsed;
}

async function callLLM(
  provider: Provider,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  const base = provider.baseURL.replace(/\/$/, "");
  const think = reasoningEnabled(provider.reasoning);

  if (provider.kind === "anthropic") {
    const budget = reasoningBudget(provider.reasoning);
    const res = await smartFetch(`${base}/v1/messages`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: think ? budget + 8192 : 8192,
        // Extended thinking requires temperature = 1.
        temperature: think ? 1 : 0,
        ...(think ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.content
      ?.filter((c: { type?: string }) => c.type !== "thinking")
      .map((c: { text?: string }) => c.text ?? "")
      .join("") ?? "";
  }

  if (provider.kind === "gemini") {
    // Key goes in a header, not the query string: a relayed request would
    // otherwise leak it into the proxy's logs and any error message echoing the URL.
    const url = `${base}/v1beta/models/${provider.model}:generateContent`;
    const res = await smartFetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": provider.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          ...(think ? { thinkingConfig: { thinkingBudget: reasoningBudget(provider.reasoning) } } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  }

  // openai-compatible (normalized base handles ".../zen" without /v1)
  const res = await smartFetch(`${openaiBase(provider.baseURL)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      ...(think ? { reasoning_effort: provider.reasoning } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

/** Generic single-shot completion (used by term extraction). Not for google-free. */
export async function llmComplete(
  provider: Provider,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  return callLLM(provider, system, user, withTimeout(signal ?? null, 120_000));
}

/** Tolerant parse of the model's JSON reply into exactly `count` strings. */
function parseTranslations(raw: string, count: number): string[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let arr: unknown;
  try {
    const obj = JSON.parse(text);
    arr = Array.isArray(obj) ? obj : obj?.t ?? obj?.translations;
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        arr = JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
  }
  if (Array.isArray(arr)) {
    const out = arr.map((x) => (typeof x === "string" ? x : String((x as { text?: string })?.text ?? "")));
    if (out.length === count) return out;
    // pad/truncate defensively
    return Array.from({ length: count }, (_, i) => out[i] ?? "");
  }
  throw new Error(t("error.parseTranslation"));
}

// ---------------------------------------------------------------------------
// Free Google Translate fallback (unofficial endpoint; may be CORS-limited)
// ---------------------------------------------------------------------------

async function googleTranslate(segments: string[], params: TranslateParams): Promise<string[]> {
  const sl = params.source === "auto" ? "auto" : params.source;
  const out: string[] = [];
  for (const seg of segments) {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
      `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(params.target)}` +
      `&q=${encodeURIComponent(seg)}`;
    const res = await smartFetch(url, { signal: params.signal });
    if (!res.ok) throw new Error(`Google ${res.status}`);
    const json = await res.json();
    const chunks: string = (json[0] ?? []).map((c: unknown[]) => c[0] ?? "").join("");
    out.push(chunks);
  }
  return out;
}
