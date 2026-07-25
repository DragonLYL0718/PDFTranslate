# SPDX-License-Identifier: AGPL-3.0-only
#
# PDFTranslate backend — wraps BabelDOC (AGPL-3.0) behind a small HTTP API.
# Serves the same SPA from a static folder so everything is same-origin
# (no CORS needed in the browser).
#
# Run:
#   pip install . && python -m pdftranslate_backend --port 8787
# or via Docker (see Dockerfile).

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

# -- config ---------------------------------------------------------------
HERE = Path(__file__).parent
STATIC_DIR = HERE / "dist"  # prebuilt SPA
if not STATIC_DIR.is_dir():
    # fallback: look at the repo root
    STATIC_DIR = HERE.parent / "dist"
VERSION = "0.1.0"

# BabelDOC tuning. Overridable because the right values depend on the user's
# provider: a low rate limit needs a lower QPS (BabelDOC drops any paragraph
# whose LLM call raised), and a long document needs a longer timeout.
QPS = int(os.environ.get("BABELDOC_QPS", "4"))
TIMEOUT = int(os.environ.get("BABELDOC_TIMEOUT", "1800"))

# -- app ------------------------------------------------------------------
app = FastAPI(
    title="PDFTranslate Backend",
    version=VERSION,
)

# Only these browser origins may talk to the backend. This matters because
# /proxy forwards arbitrary URLs: with "*" any page the user happens to visit
# could POST there and use this process to reach their localhost/LAN services
# — and read the responses. Mirrors the allowlist in public/proxy.mjs.
#
# NOTE: Starlette matches `allow_origins` entries as exact strings (globs like
# "http://localhost:*" never match), so port wildcards need the regex form.
ALLOWED_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://[\w-]+\.github\.io"
_ORIGIN_RE = re.compile(ALLOWED_ORIGIN_REGEX)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    # Without this the browser can't read our custom response header.
    expose_headers=["X-Translate-Stats"],
)


def _origin_allowed(origin: str | None) -> bool:
    """A missing Origin means a non-browser caller (curl, a local script) — allow."""
    return origin is None or _ORIGIN_RE.fullmatch(origin) is not None


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "name": "pdftranslate-backend",
        "version": VERSION,
        "babeldoc": _babeldoc_version(),
    }


def _babeldoc_version() -> str | None:
    try:
        r = subprocess.run(
            ["babeldoc", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        return r.stdout.strip() or None
    except Exception:
        return None


def _translation_stats(log: str) -> str | None:
    """
    Summarise how the translation actually went, as "total=N,ok=N,fallback=N,error=N".

    BabelDOC never fails the run over a bad paragraph: a raised LLM call is
    logged and the paragraph skipped, and an empty model response is written
    out as-is. Either way it exits 0 and returns a PDF with text missing, which
    reads to the user as broken layout. Its own end-of-run tally tells the real
    story, so we forward it instead of reporting unqualified success.

    `rich` hard-wraps log lines, so match against whitespace-collapsed text.
    """
    flat = re.sub(r"\s+", " ", log)
    m = re.search(
        r"Translation completed\. Total: (\d+), Successful: (\d+), Fallback: (\d+)", flat
    )
    if not m:
        return None
    errors = flat.count("Error translating paragraph")
    return f"total={m[1]},ok={m[2]},fallback={m[3]},error={errors}"


# -- translate endpoint ---------------------------------------------------
@app.post("/api/translate")
async def translate(
    file: UploadFile = File(...),
    source: str = Form("auto"),
    target: str = Form("zh"),
    # 1-based page selection in BabelDOC syntax ("1,3,5-8"). Empty = all pages.
    pages: str = Form(""),
    # "disabled" tells reasoning-capable models to answer directly. Left on,
    # such a model can spend its whole output budget thinking and return an
    # empty translation, which BabelDOC counts as a failure and drops.
    thinking: str = Form(""),
    # OpenAI-compatible LLM config — BabelDOC needs a translator to run.
    openai_base_url: str = Form(""),
    openai_api_key: str = Form(""),
    openai_model: str = Form(""),
):
    """
    Translate a PDF using BabelDOC. Accepts a multipart upload plus the
    OpenAI-compatible provider config (base url / api key / model).

    Returns the translated (monolingual) PDF bytes on success.
    """
    if not _babeldoc_version():
        return JSONResponse(
            status_code=501,
            content={"error": "BabelDOC 未安装。请运行：uv tool install --python 3.12 BabelDOC"},
        )
    if not openai_api_key:
        return JSONResponse(
            status_code=400,
            content={"error": "缺少翻译模型配置：请在应用中配置一个 OpenAI 兼容的提供商（含 API Key）后重试。"},
        )

    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp(prefix=f"pdft_{uuid4().hex[:12]}_")
        in_path = Path(tmp_dir) / "input.pdf"
        out_dir = Path(tmp_dir) / "output"

        # Write uploaded file
        content = await file.read()
        in_path.write_bytes(content)

        # Build BabelDOC command. NOTE: input goes through --files, languages use
        # --lang-in/--lang-out, and an OpenAI translator must be supplied.
        cmd = [
            "babeldoc",
            "--files", str(in_path),
            "--output", str(out_dir),
            "--lang-out", target,
            "--openai",
            "--openai-model", openai_model or "gpt-4o-mini",
            "--openai-base-url", openai_base_url or "https://api.openai.com/v1",
            "--openai-api-key", openai_api_key,
            "--qps", str(QPS),
        ]
        if source and source != "auto":
            cmd.extend(["--lang-in", source])
        # Note: no --only-include-translated-page, so the output keeps every
        # page (untranslated ones verbatim) and page N of the result still
        # lines up with page N of the source, like engine A's overlays do.
        if pages.strip():
            cmd.extend(["--pages", pages.strip()])
        if thinking in ("enabled", "disabled"):
            cmd.extend(["--openai-thinking", thinking])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # BabelDOC logs through `rich`, which hard-wraps to the terminal
            # width — 80 by default off a TTY, which splits messages mid-phrase
            # and makes them unmatchable (and unreadable when we echo them back).
            env={**os.environ, "COLUMNS": "200"},
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT)
        # rich writes to stdout, so translation errors are NOT on stderr.
        log = (stdout + stderr).decode(errors="replace")

        if proc.returncode != 0:
            return JSONResponse(
                status_code=500,
                content={"error": f"BabelDOC failed: {log}"},
            )

        # Find output PDF. BabelDOC emits a bilingual ("dual") and a
        # monolingual ("mono") PDF; prefer the mono (translated-only) result.
        pdf_files = list(out_dir.glob("*.pdf"))
        if not pdf_files:
            return JSONResponse(
                status_code=500,
                content={"error": "BabelDOC produced no output PDF"},
            )
        mono = [p for p in pdf_files if "mono" in p.name.lower()]
        out_file = mono[0] if mono else pdf_files[0]

        out_bytes = out_file.read_bytes()

        headers = {"Content-Disposition": "attachment; filename=translated.pdf"}
        stats = _translation_stats(log)
        if stats:
            headers["X-Translate-Stats"] = stats

        return Response(content=out_bytes, media_type="application/pdf", headers=headers)

    except asyncio.TimeoutError:
        return JSONResponse(status_code=504, content={"error": f"BabelDOC 超时（{TIMEOUT}s）"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)


# -- CORS relay -----------------------------------------------------------
# Some AI providers (opencode zen, self-hosted gateways, …) don't send CORS
# headers, so a browser page can't call them directly. The frontend relays such
# requests here and we forward them server-side (no CORS limits), returning the
# upstream response verbatim. This lets one running backend cover both
# high-fidelity translation and CORS relaying — no separate proxy process.
@app.post("/proxy")
async def proxy(request: Request):
    # Defence in depth: CORS already stops a disallowed page from *reading* the
    # response, but reject the request outright so we never make the outbound
    # call on its behalf. A browser can't forge Origin, which is the threat here.
    if not _origin_allowed(request.headers.get("origin")):
        return JSONResponse(status_code=403, content={"error": "origin not allowed"})

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})

    target = payload.get("url")
    if not target:
        return JSONResponse(status_code=400, content={"error": "missing target url"})
    method = (payload.get("method") or "GET").upper()
    headers = payload.get("headers") or {}
    body = payload.get("body")

    def _forward():
        data = body.encode("utf-8") if isinstance(body, str) else body
        # urllib's default UA ("Python-urllib/x") is blocked by some gateways
        # (e.g. Cloudflare-fronted providers → 403). Present as a normal client.
        hdrs = dict(headers)
        if not any(k.lower() == "user-agent" for k in hdrs):
            hdrs["User-Agent"] = (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        req = urllib.request.Request(target, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, resp.headers.get("content-type", "application/json"), resp.read()
        except urllib.error.HTTPError as e:
            # Pass provider error responses (401/429/…) through with their body.
            return e.code, e.headers.get("content-type", "application/json"), e.read()

    try:
        status, ctype, content = await asyncio.to_thread(_forward)
        return Response(content=content, status_code=status, media_type=ctype)
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


# -- serve SPA (optional) ------------------------------------------------
# When installed as a tool (uv/pip), there is no bundled frontend — users open
# the GitHub Pages site instead, which talks to this backend over /api/*.
_PORT = os.environ.get("PORT", 8787)
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="spa")
    print(f"\n✓ 后端 + 前端已就绪：http://127.0.0.1:{_PORT}")
else:
    print(f"\n✓ 后端已就绪：http://127.0.0.1:{_PORT}")
    print(f"   在 PDFTranslate 网页里点「测试连接」即可开始使用高保真引擎。")


def main():
    import uvicorn
    port = int(os.environ.get("PORT", 8787))
    uvicorn.run("pdftranslate_backend:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    main()
