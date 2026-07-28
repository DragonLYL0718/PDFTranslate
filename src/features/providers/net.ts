// Network layer: calls AI providers directly when possible, and transparently
// relays through a local helper when the browser blocks a provider by CORS.
// The relay can be the BabelDOC backend (which also serves /proxy) or the
// standalone proxy script — so one running service is enough.

let proxy = { enabled: false, url: "http://localhost:8788" };
// The BabelDOC backend doubles as a CORS relay; always a fallback candidate.
let backendUrl = "http://localhost:8787";

import { t } from "@/i18n";

// Provider origins we've learned require relaying (a direct call failed with a
// network/CORS error). Skips the doomed direct attempt on subsequent batches.
const relayHosts = new Set<string>();

/** Thrown when a request needs a local relay but none is reachable. */
export class ProxyUnavailableError extends Error {
  constructor(public target: string) {
    super(t("error.proxyUnavailable"));
    this.name = "ProxyUnavailableError";
  }
}

export function setProxyConfig(next: { enabled: boolean; url: string }): void {
  proxy = next;
  relayHealth = null;
  relayProbe = null;
}

/** Point the relay at the BabelDOC backend so one running service covers both. */
export function setRelayBackend(url: string): void {
  backendUrl = url;
  relayHealth = null;
  relayProbe = null;
}

function headerObject(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const o: Record<string, string> = {};
    h.forEach((v, k) => (o[k] = v));
    return o;
  }
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}

/** Detect a fetch failure that is most likely CORS / network (not an HTTP error). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}

/** Combine an optional caller signal with a timeout so requests can't hang forever. */
export function withTimeout(signal: AbortSignal | null | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Ordered local relay bases to try: an explicit proxy first, then the backend. */
function relayBases(): string[] {
  const bases: string[] = [];
  if (proxy.enabled && proxy.url) bases.push(proxy.url);
  if (backendUrl) bases.push(backendUrl);
  return bases.map((u) => u.replace(/\/$/, ""));
}

/** Relay one request through the first reachable local helper. */
async function relayFetch(url: string, init: RequestInit | undefined, bases: string[]): Promise<Response> {
  const payload = JSON.stringify({
    url,
    method: init?.method ?? "GET",
    headers: headerObject(init?.headers),
    body: (init?.body as string | null) ?? null,
  });
  for (const base of bases) {
    try {
      return await fetch(`${base}/proxy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: init?.signal ?? null,
      });
    } catch (e) {
      if (!isNetworkError(e)) throw e; // e.g. caller aborted — don't mask it
      // otherwise this relay is down; try the next candidate
    }
  }
  throw new ProxyUnavailableError(url);
}

/**
 * fetch() that reaches CORS-blocked providers via a local relay. Tries a direct
 * call first; on a network/CORS failure it retries through a running relay (the
 * BabelDOC backend or the standalone proxy). If none is reachable it throws
 * ProxyUnavailableError so the UI can prompt the user to start the service.
 */
export async function smartFetch(url: string, init?: RequestInit): Promise<Response> {
  const host = originOf(url);

  // Explicit proxy, or a host already known to be CORS-blocked: relay directly.
  if (proxy.enabled || relayHosts.has(host)) {
    return relayFetch(url, init, relayBases());
  }

  try {
    return await fetch(url, init);
  } catch (e) {
    if (!isNetworkError(e)) throw e; // real abort/timeout — not a CORS problem
    const res = await relayFetch(url, init, relayBases());
    relayHosts.add(host); // remember so the next batch skips the direct attempt
    return res;
  }
}

// ---------------------------------------------------------------------------
// Relay capabilities
// ---------------------------------------------------------------------------

interface RelayHealth {
  /** Relay pipes the upstream body through instead of buffering it (SSE works). */
  streaming: boolean;
}

let relayHealth: RelayHealth | null = null;
let relayProbe: Promise<RelayHealth | null> | null = null;
let relayProbedAt = 0;
const PROBE_TTL = 30_000;

/** True when a request to this URL is going through the local relay. */
export function willRelay(url: string): boolean {
  return proxy.enabled || relayHosts.has(originOf(url));
}

/**
 * Capabilities of the first reachable relay. The standalone proxy answers on
 * /health and the BabelDOC backend only on /api/health, so each candidate base
 * is tried on both paths. A successful probe is cached until the relay config
 * changes; a failure is retried, so starting the helper later still works.
 */
export async function probeRelay(): Promise<RelayHealth | null> {
  if (relayHealth) return relayHealth;
  if (relayProbe && Date.now() - relayProbedAt < PROBE_TTL) return relayProbe;
  relayProbedAt = Date.now();
  relayProbe = (async () => {
    for (const base of relayBases()) {
      for (const path of ["/health", "/api/health"]) {
        try {
          const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) continue;
          const json = await res.json();
          if (!json?.ok) continue;
          const health: RelayHealth = {
            streaming: json.version >= 2 || (json.features ?? []).includes("stream"),
          };
          relayHealth = health;
          return health;
        } catch {
          // this path/base isn't it; try the next
        }
      }
    }
    return null;
  })();
  return relayProbe;
}

/**
 * Whether a streamed request to this URL will actually arrive incrementally.
 * Direct calls always can; a relayed one only if the local helper pipes rather
 * than buffers, which older versions don't.
 */
export async function canStream(url: string): Promise<boolean> {
  if (!willRelay(url)) return true;
  return (await probeRelay())?.streaming ?? false;
}

/** Health-check the local proxy. */
export async function pingProxy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
