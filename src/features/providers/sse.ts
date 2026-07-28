// Server-sent events, the transport every streaming chat API speaks. Shared by
// all three provider kinds; what the payloads *mean* is provider-specific and
// lives in llm.ts.

/** Events are separated by a blank line; `data:` may span several lines. */
const EVENT_SEP = /\r?\n\r?\n/;
const DATA_LINE = /^data:[ ]?(.*)$/;

/** True when the response really is a stream, not a buffered JSON reply. */
export function isEventStream(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
}

/** Join the `data:` lines of one raw event; null for comments and keep-alives. */
function dataOf(event: string): string | null {
  const parts: string[] = [];
  for (const line of event.split(/\r?\n/)) {
    // ":" starts a comment — Anthropic uses those as pings.
    if (!line || line.startsWith(":")) continue;
    const m = DATA_LINE.exec(line);
    if (m) parts.push(m[1]);
  }
  return parts.length ? parts.join("\n") : null;
}

/**
 * Yield the `data:` payload of each event in a response body, stopping at the
 * `[DONE]` sentinel. Throws if the body isn't readable so the caller can retry
 * without streaming.
 */
export async function* sseEvents(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error("response has no readable body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (let m = EVENT_SEP.exec(buf); m; m = EVENT_SEP.exec(buf)) {
        const raw = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const payload = dataOf(raw);
        if (payload === "[DONE]") return;
        if (payload !== null) yield payload;
      }
    }
    // Some servers close without the final blank line.
    const tail = dataOf(buf + decoder.decode());
    if (tail !== null && tail !== "[DONE]") yield tail;
  } finally {
    reader.cancel().catch(() => {});
  }
}
