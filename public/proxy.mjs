#!/usr/bin/env node
// PDFTranslate local proxy — forwards AI-provider requests to bypass browser CORS.
//
// Why: a page hosted in the browser can only call AI providers that send CORS
// headers. Providers like self-hosted gateways don't, so the browser blocks them.
// This tiny relay runs on your machine (no CORS limits) and forwards requests.
//
// Privacy: nothing is stored or sent anywhere except to the exact provider URL
// your app already targets. Traffic only flows browser -> localhost -> provider.
//
// Requirements: Node 18+ (built-in fetch). Zero dependencies.
// Run:  node proxy.mjs           (defaults to port 8788)
//       PORT=9000 node proxy.mjs
import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PORT = +(process.env.PORT || 8788);

// Only these browser origins may use the proxy (prevents random sites abusing it).
// Includes the app's own custom domain, not just the github.io default — a fork
// on another domain can add it with ALLOW_ORIGIN=https://my.site node proxy.mjs.
const ALLOW_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[\w-]+\.github\.io$/,
  /^https:\/\/pdftranslate\.rayleigh-lin\.top$/,
];

if (process.env.ALLOW_ORIGIN) {
  const extra = process.env.ALLOW_ORIGIN.replace(/\/$/, "");
  ALLOW_ORIGINS.push(new RegExp(`^${extra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

function allowedOrigin(origin) {
  if (!origin) return "*";
  return ALLOW_ORIGINS.some((re) => re.test(origin)) ? origin : "";
}

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin(origin) || "null");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    // A page served over https reaching http://localhost is a Private Network
    // Access request: the browser preflights it and drops the call unless we
    // answer with this header. Only for origins on the allowlist above.
    if (req.headers["access-control-request-private-network"] && allowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    // version 2 = pipes the upstream body through, so SSE survives the relay.
    // The app checks this before asking a provider to stream.
    res.end(JSON.stringify({ ok: true, name: "pdftranslate-proxy", version: 2, features: ["stream"] }));
    return;
  }

  if (url.pathname === "/proxy" && req.method === "POST") {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { url: target, method = "GET", headers = {}, body = null } = JSON.parse(
        Buffer.concat(chunks).toString() || "{}",
      );
      if (!target) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing target url" }));
        return;
      }
      // Abort upstream when the browser disconnects, or every cancelled chat
      // turn would leave a provider connection open for the life of the process.
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      const upstream = await fetch(target, {
        method,
        headers,
        body: body ?? undefined,
        signal: ac.signal,
      });
      // Only content-type is forwarded: the body is relayed as received, so
      // passing on content-length/content-encoding could contradict it.
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-cache, no-transform",
      });
      // Pipe rather than buffer, so server-sent events arrive token by token.
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
      else res.end();
    } catch (e) {
      // Once the status line is out we can't turn the response into a 502.
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

// Try the preferred port; if already in use, proxy is probably already running.
server.listen(PORT, () => {
  console.log(`PDFTranslate proxy running on http://localhost:${PORT}`);
  console.log("Keep this window open while translating. Press Ctrl+C to stop.");
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} is already in use — proxy is probably already running.`);
    console.log("If not, kill the old process or set PORT=xxxx and try again.");
    process.exit(0); // not an error
  }
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
