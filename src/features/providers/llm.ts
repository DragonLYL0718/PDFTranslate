// One call shape for every provider kind, with or without streaming.
//
// Extracted from translate.ts, which now delegates here. The structured callers
// (translation, term extraction, locale generation) pass `json: true` and no
// temperature, which reproduces exactly what they used to send — the JSON
// response format and temperature 0 must stay opt-in, or a free-form chat reply
// comes back mangled on Gemini.

import type { Provider } from "@/types";
import { openaiBase, reasoningBudget, reasoningEnabled } from "./util";
import { anySignal, canStream, smartFetch } from "./net";
import { isEventStream, sseEvents } from "./sse";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  system: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
  /** Ask the provider itself for JSON. Off for chat — it wrecks free-form replies. */
  json?: boolean;
  /** Defaults to 0; chat wants some warmth. */
  temperature?: number;
  maxTokens?: number;
  /** Passing this asks for a stream; it receives incremental text only. */
  onDelta?: (text: string) => void;
  /** Inactivity watchdog for streams. A stream has no total deadline. */
  stallMs?: number;
}

/** Per-provider request shape plus the two extractors for its response. */
interface Wire {
  label: string;
  headers: Record<string, string>;
  body: unknown;
  /** Full text from a non-streamed reply. */
  whole: (json: any) => string;
  /** Incremental text from one SSE payload; "" for frames that carry none. */
  delta: (json: any) => string;
}

function endpoint(provider: Provider, stream: boolean): string {
  const base = provider.baseURL.replace(/\/$/, "");
  if (provider.kind === "anthropic") return `${base}/v1/messages`;
  if (provider.kind === "gemini") {
    const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${base}/v1beta/models/${provider.model}:${method}`;
  }
  // normalized base handles ".../zen" without /v1
  return `${openaiBase(provider.baseURL)}/chat/completions`;
}

function buildWire(provider: Provider, opts: LlmCallOptions, stream: boolean): Wire {
  const think = reasoningEnabled(provider.reasoning);
  const temperature = opts.temperature ?? 0;

  if (provider.kind === "anthropic") {
    const budget = reasoningBudget(provider.reasoning);
    const maxTokens = opts.maxTokens ?? 8192;
    return {
      label: "Anthropic",
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model: provider.model,
        max_tokens: think ? budget + maxTokens : maxTokens,
        // Extended thinking requires temperature = 1.
        temperature: think ? 1 : temperature,
        ...(think ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
        system: opts.system,
        messages: opts.messages,
        ...(stream ? { stream: true } : {}),
      },
      whole: (json) =>
        json.content
          ?.filter((c: { type?: string }) => c.type !== "thinking")
          .map((c: { text?: string }) => c.text ?? "")
          .join("") ?? "",
      delta: (json) =>
        json.type === "content_block_delta" && json.delta?.type === "text_delta"
          ? json.delta.text ?? ""
          : "",
    };
  }

  if (provider.kind === "gemini") {
    const parts = (json: any): string =>
      json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return {
      label: "Gemini",
      // Key goes in a header, not the query string: a relayed request would
      // otherwise leak it into the proxy's logs and any error message echoing the URL.
      headers: { "content-type": "application/json", "x-goog-api-key": provider.apiKey },
      body: {
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: opts.messages.map((m) => ({
          // Gemini calls the assistant "model".
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
          ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
          ...(think ? { thinkingConfig: { thinkingBudget: reasoningBudget(provider.reasoning) } } : {}),
        },
      },
      whole: parts,
      delta: parts,
    };
  }

  return {
    label: "OpenAI",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: {
      model: provider.model,
      temperature,
      ...(think ? { reasoning_effort: provider.reasoning } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
      ...(stream ? { stream: true } : {}),
    },
    whole: (json) => json.choices?.[0]?.message?.content ?? "",
    delta: (json) => json.choices?.[0]?.delta?.content ?? "",
  };
}

/** Providers report mid-stream failures as a data frame rather than an HTTP status. */
function streamError(json: any): string | null {
  if (json?.type === "error") return json.error?.message ?? "stream error";
  if (json?.error) return json.error.message ?? String(json.error);
  return null;
}

/** One completion, streamed when possible. Always returns the full text. */
export async function llmCall(provider: Provider, opts: LlmCallOptions): Promise<string> {
  const stream = opts.onDelta ? await canStream(endpoint(provider, false)) : false;
  const url = endpoint(provider, stream);
  const wire = buildWire(provider, opts, stream);

  // A stream has no sensible total deadline — a long summary legitimately runs
  // past any of them — so bound silence instead. Non-streaming keeps whatever
  // timeout the caller composed into `signal`.
  const stall = stream ? new AbortController() : null;
  let stallTimer: number | undefined;
  const resetStall = () => {
    if (!stall) return;
    window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(
      () => stall.abort(new DOMException("stream stalled", "TimeoutError")),
      opts.stallMs ?? 60_000,
    );
  };
  const signal = stall
    ? opts.signal
      ? anySignal([opts.signal, stall.signal])
      : stall.signal
    : opts.signal;

  try {
    resetStall();
    const res = await smartFetch(url, {
      method: "POST",
      signal,
      headers: wire.headers,
      body: JSON.stringify(wire.body),
    });
    if (!res.ok) throw new Error(`${wire.label} ${res.status}: ${await res.text()}`);

    if (!stream) return wire.whole(await res.json());

    // We can mispredict: an origin whose first direct call fails CORS is relayed
    // transparently, and a relay that ignores `stream` answers with plain JSON.
    // Parse it whole and hand it over in one delta so the UI still updates.
    if (!isEventStream(res)) {
      const text = wire.whole(await res.json());
      if (text) opts.onDelta!(text);
      return text;
    }

    let out = "";
    for await (const payload of sseEvents(res)) {
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // a frame split across chunks; the reader will resync
      }
      const err = streamError(json);
      if (err) throw new Error(`${wire.label}: ${err}`);
      const piece = wire.delta(json);
      resetStall();
      if (!piece) continue;
      out += piece;
      opts.onDelta!(piece);
    }
    return out;
  } finally {
    window.clearTimeout(stallTimer);
  }
}
