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
import atexit
import codecs
import contextlib
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

# -- config ---------------------------------------------------------------
HERE = Path(__file__).parent
STATIC_DIR = HERE / "dist"  # prebuilt SPA
if not STATIC_DIR.is_dir():
    # fallback: look at the repo root
    STATIC_DIR = HERE.parent / "dist"
VERSION = "0.1.1"

# BabelDOC tuning. Overridable because the right values depend on the user's
# provider: a low rate limit needs a lower QPS (BabelDOC drops any paragraph
# whose LLM call raised), and a long document needs a longer timeout.
QPS = int(os.environ.get("BABELDOC_QPS", "4"))
TIMEOUT = int(os.environ.get("BABELDOC_TIMEOUT", "1800"))

# Socket timeout for relayed provider calls. urllib applies this per read, not
# to the whole exchange, so a stream that keeps producing tokens never trips it
# — this only bounds silence (e.g. a long first token behind extended thinking).
PROXY_TIMEOUT = int(os.environ.get("PROXY_TIMEOUT", "300"))

# Where to find BabelDOC. The desktop shell installs it into its own private
# directory and passes the full path, which is more robust than hoping the
# spawned process inherited the right PATH — on Windows especially.
BABELDOC_BIN = os.environ.get("BABELDOC_BIN", "babeldoc")

# Spawning a console app from a GUI process pops a console window on Windows.
# Every subprocess here is a background detail the user should never see.
_NO_WINDOW: dict = (
    {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
)

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
def _extra_origins() -> str:
    """
    Regex alternatives for PDFT_EXTRA_ORIGINS (comma-separated). The desktop
    shell fills this with the exact origin its webview ended up on, so the
    allowlist doesn't have to guess at Tauri's scheme conventions.
    """
    raw = os.environ.get("PDFT_EXTRA_ORIGINS", "")
    return "".join("|" + re.escape(o.strip()) for o in raw.split(",") if o.strip())


ALLOWED_ORIGIN_REGEX = (
    r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
    r"|https://[\w-]+\.github\.io"
    r"|https://pdftranslate\.rayleigh-lin\.top"
    # The desktop shell's own origin: tauri://localhost on macOS and Linux,
    # http://tauri.localhost on Windows. Neither matches the loopback rule
    # above, whose host part has to be exactly localhost or 127.0.0.1.
    r"|tauri://localhost"
    r"|http://tauri\.localhost"
) + _extra_origins()
_ORIGIN_RE = re.compile(ALLOWED_ORIGIN_REGEX)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    # A page served over https (the GitHub Pages deployment) reaching
    # http://localhost is a Private Network Access request: the browser sends a
    # preflight carrying `Access-Control-Request-Private-Network: true` and
    # fails the call unless we answer with the matching allow header. Without
    # this every request from the hosted app dies before it arrives, and the app
    # can only report "backend unreachable". The origin allowlist above is what
    # keeps this safe — it is not an opening to arbitrary pages.
    allow_private_network=True,
    # Without this the browser can't read our custom response header.
    expose_headers=["X-Report-Id"],
)

# Per-run reports (extracted glossary + failed paragraphs), handed out once by
# /api/report/{id}. The translate response body is the PDF and this payload is
# both too big and too non-ASCII for a header, so it waits here instead.
# Bounded so a long-lived backend can't grow without limit.
_REPORTS: OrderedDict[str, dict] = OrderedDict()
_REPORT_LIMIT = 32


def _origin_allowed(origin: str | None) -> bool:
    """A missing Origin means a non-browser caller (curl, a local script) — allow."""
    return origin is None or _ORIGIN_RE.fullmatch(origin) is not None


@app.get("/api/health")
async def health(refresh: int = 0):
    return {
        "ok": True,
        "name": "pdftranslate-backend",
        "version": VERSION,
        # ?refresh=1 re-runs the probe, for right after an install.
        "babeldoc": _babeldoc_version(refresh=bool(refresh)),
        # Lets the app tell "this backend predates per-run reports, restart it"
        # apart from "this run genuinely produced no terms". "stream" means
        # /proxy pipes the upstream body through, so relayed SSE arrives live.
        # "progress" means /api/progress/{job_id} tracks a running translation.
        "features": ["report", "stream", "progress"],
    }


# Spawning babeldoc costs ~a second, and /api/health is polled on mount, on
# every import dialog, on every "test connection" and by the desktop shell while
# it waits for startup — so the answer is worked out once and kept.
_BABELDOC_VERSION: str | None = None
_BABELDOC_CHECKED = False


def _babeldoc_version(refresh: bool = False) -> str | None:
    global _BABELDOC_VERSION, _BABELDOC_CHECKED
    if _BABELDOC_CHECKED and not refresh:
        return _BABELDOC_VERSION
    try:
        r = subprocess.run(
            [BABELDOC_BIN, "--version"],
            capture_output=True, text=True, timeout=10, **_NO_WINDOW,
        )
        _BABELDOC_VERSION = r.stdout.strip() or None
    except Exception:
        _BABELDOC_VERSION = None
    _BABELDOC_CHECKED = True
    return _BABELDOC_VERSION


# A paragraph the per-paragraph translator gave up on. This is the *last*
# attempt, so unlike the batch stage's own errors it really does mean the
# paragraph keeps its source text. BabelDOC logs the id and the original text.
_FAILED_PARAGRAPH_RE = re.compile(
    r"Error translating paragraph\. Paragraph: (\S+) \((.*?)\)\. Error: (.*?)(?=Traceback|Error translating|$)"
)
_TALLY_RE = re.compile(
    r"Translation completed\. Total: (\d+), Successful: (\d+), Fallback: (\d+)"
)


def _translation_report(log: str) -> dict:
    """
    Work out what actually went wrong, from BabelDOC's log.

    BabelDOC's own end-of-run tally counts "Fallback" paragraphs, but a fallback
    is NOT a failure: the batched LLM stage declines the paragraph (bad JSON,
    placeholder mismatch, edit distance too small, …) and resubmits it to the
    slower per-paragraph translator, which normally succeeds. Reporting
    `total - ok` as broken therefore accused the translation of losing text that
    is right there in the PDF.

    A paragraph is only really lost when that second attempt also raises, which
    BabelDOC logs with the paragraph id and its source text.

    `rich` hard-wraps log lines, so match against whitespace-collapsed text.
    """
    flat = re.sub(r"\s+", " ", log)
    tally = _TALLY_RE.search(flat)

    failures: list[dict] = []
    seen: set[str] = set()
    for m in _FAILED_PARAGRAPH_RE.finditer(flat):
        pid = m[1]
        if pid in seen:
            continue
        seen.add(pid)
        failures.append(
            {"id": pid, "text": m[2].strip()[:120], "error": m[3].strip()[:200]}
        )

    return {
        "total": int(tally[1]) if tally else 0,
        "ok": int(tally[2]) if tally else 0,
        "fallback": int(tally[3]) if tally else 0,
        # Paragraphs blocked by the provider's content filter keep their source
        # text too, but are logged without an id.
        "filtered": flat.count("ContentFilterError:"),
        "failures": failures,
    }


# -- live progress --------------------------------------------------------
# BabelDOC reports progress only by drawing a `rich` bar, and rich paints
# nothing at all while it believes it is writing to a pipe — FORCE_COLOR on the
# subprocess is what makes the frames appear, and this parses them back out.
# The client picks the job id, so it can start polling while it is still
# uploading, before this request has begun.
_PROGRESS: OrderedDict[str, float] = OrderedDict()
_PROGRESS_LIMIT = 32

# Colour/cursor codes, and the OSC hyperlinks rich wraps the log's file column
# in once it believes it is on a terminal — those would otherwise end up in the
# failure text we show the user.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
# The task rich draws for the run as a whole: description "translate" and a
# MofNCompleteColumn out of 100 — "translate ━━━╸… 42/100 0:01:23 0:02:00".
# Per-stage bars are described "Translate Paragraph (1/1)", so the lowercase
# name only ever matches the overall one.
_OVERALL_RE = re.compile(r"^translate\s.*?(\d{1,3})/100(?:\s|$)")
# Glyphs BarColumn draws with. Frames arrive ~10 times a second, so they are
# recognised and dropped rather than piling up in the log we keep.
_BAR_CHARS = ("━", "╸", "╺")


# The babeldoc run in flight, if any. Tracked so shutdown can take it down:
# it is a child of this process, and on Windows nothing kills it for us.
_CURRENT_PROC: asyncio.subprocess.Process | None = None


def _terminate_child() -> None:
    """Stop the running babeldoc, if there is one. Safe to call repeatedly."""
    proc = _CURRENT_PROC
    if proc is None or proc.returncode is not None:
        return
    with contextlib.suppress(Exception):
        proc.kill()


def _set_progress(job_id: str, percent: float) -> None:
    _PROGRESS[job_id] = percent
    _PROGRESS.move_to_end(job_id)
    while len(_PROGRESS) > _PROGRESS_LIMIT:
        _PROGRESS.popitem(last=False)


@app.get("/api/progress/{job_id}")
async def get_progress(job_id: str):
    """How far a running translation has got, 0-100."""
    percent = _PROGRESS.get(job_id)
    if percent is None:
        return JSONResponse(status_code=404, content={"error": "unknown job"})
    return {"percent": percent}


def _consume_line(line: str, job_id: str, log: list[str]) -> None:
    """Route one line of BabelDOC output: progress frame, or something to keep."""
    clean = _ANSI_RE.sub("", line)
    if not any(c in clean for c in _BAR_CHARS):
        log.append(clean)
        return
    m = _OVERALL_RE.match(clean.strip())
    if m and job_id:
        _set_progress(job_id, min(100.0, float(m[1])))


async def _drain(stream: asyncio.StreamReader, job_id: str, log: list[str]) -> None:
    """
    Read one of BabelDOC's output streams to the end, splitting on carriage
    returns as well as newlines — rich repaints a frame by returning to the
    start of the line rather than ending it, so a line-oriented read would sit
    on a whole frame until the next one arrived.
    """
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    buf = ""
    while True:
        chunk = await stream.read(4096)
        buf += decoder.decode(chunk, final=not chunk)
        lines = re.split(r"[\r\n]", buf)
        buf = lines.pop()
        for line in lines:
            _consume_line(line, job_id, log)
        if not chunk:
            break
    if buf:
        _consume_line(buf, job_id, log)


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
    # "off" turns off BabelDOC's own term extraction (it is on by default, and
    # costs extra model calls). Anything else keeps it on and saves the result.
    auto_glossary: str = Form(""),
    # Client-chosen id this run reports its progress under, for /api/progress.
    job_id: str = Form(""),
    # OpenAI-compatible LLM config — BabelDOC needs a translator to run.
    openai_base_url: str = Form(""),
    openai_api_key: str = Form(""),
    openai_model: str = Form(""),
    strip_highlights: str = Form(""),
):
    """
    Translate a PDF using BabelDOC. Accepts a multipart upload plus the
    OpenAI-compatible provider config (base url / api key / model).

    Returns the translated (monolingual) PDF bytes on success.
    """
    # A cached "missing" can be stale — the user may have just installed it —
    # so re-check before refusing. A cached hit never goes stale that way.
    if not _babeldoc_version(refresh=_BABELDOC_VERSION is None):
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
            BABELDOC_BIN,
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
        # Highlights flattened into the page content are opaque filled rects, and
        # BabelDOC re-emits them after the translated text, burying it. This drops
        # decorative fills from paragraph areas (figures/tables stay protected);
        # the app repaints the highlights over the result instead. Only sent when
        # the client actually found flattened highlights, so documents that rely
        # on rules inside paragraphs keep them.
        if strip_highlights == "on":
            cmd.append("--remove-non-formula-lines")
        # BabelDOC extracts a glossary during translation to keep terminology
        # consistent; --save-auto-extracted-glossary is what writes it out so we
        # can hand it back to the app.
        if auto_glossary == "off":
            cmd.append("--no-auto-extract-glossary")
        else:
            cmd.append("--save-auto-extracted-glossary")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # BabelDOC logs through `rich`, which hard-wraps to the terminal
            # width — 80 by default off a TTY, which splits messages mid-phrase
            # and makes them unmatchable (and unreadable when we echo them back).
            # FORCE_COLOR makes rich treat the pipe as a terminal, which is the
            # only way it paints its progress bar while the run is going; the
            # escape codes it also emits are stripped as we read.
            env={**os.environ, "COLUMNS": "200", "FORCE_COLOR": "1"},
            **_NO_WINDOW,
        )
        global _CURRENT_PROC
        _CURRENT_PROC = proc
        if job_id:
            _set_progress(job_id, 0.0)
        # rich writes to stdout, so translation errors are NOT on stderr.
        lines: list[str] = []
        try:
            await asyncio.wait_for(
                asyncio.gather(
                    _drain(proc.stdout, job_id, lines),
                    _drain(proc.stderr, job_id, lines),
                    proc.wait(),
                ),
                timeout=TIMEOUT,
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise
        log = "\n".join(lines)

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

        report = _translation_report(log)
        report["glossary_csv"] = _read_glossary(out_dir)
        headers = {
            "Content-Disposition": "attachment; filename=translated.pdf",
            "X-Report-Id": _stash_report(report),
        }
        return Response(content=out_bytes, media_type="application/pdf", headers=headers)

    except asyncio.TimeoutError:
        return JSONResponse(status_code=504, content={"error": f"BabelDOC 超时（{TIMEOUT}s）"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        _CURRENT_PROC = None
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)


def _read_glossary(out_dir: Path) -> str | None:
    """
    Read the auto-extracted glossary CSV. BabelDOC writes it next to the PDFs as
    `<name>.<lang>.glossary.csv` (utf-8-sig); the temp directory is wiped when
    this request returns, so pull it out now.
    """
    files = sorted(out_dir.glob("*.glossary.csv"))
    if not files:
        return None
    try:
        csv_text = files[0].read_text(encoding="utf-8-sig")
    except Exception:
        return None
    return csv_text if csv_text.strip() else None


def _stash_report(report: dict) -> str:
    rid = uuid4().hex
    _REPORTS[rid] = report
    while len(_REPORTS) > _REPORT_LIMIT:
        _REPORTS.popitem(last=False)
    return rid


@app.get("/api/report/{rid}")
async def get_report(rid: str):
    """Hand over a run's report once, then forget it."""
    report = _REPORTS.pop(rid, None)
    if report is None:
        return JSONResponse(status_code=404, content={"error": "report not found"})
    return report


# -- CORS relay -----------------------------------------------------------
# Some AI providers (opencode zen, self-hosted gateways, …) don't send CORS
# headers, so a browser page can't call them directly. The frontend relays such
# requests here and we forward them server-side (no CORS limits), returning the
# upstream response verbatim. This lets one running backend cover both
# high-fidelity translation and CORS relaying — no separate proxy process.
# The desktop shell reaches providers through Rust and never calls this, so it
# switches the route off entirely. Worth doing: /proxy forwards to any URL for
# any local caller — a missing Origin is read as a non-browser client and
# allowed — and that is free to give up when nothing needs it.
PROXY_ENABLED = os.environ.get("PDFT_DISABLE_PROXY") != "1"


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

    def _open():
        """Start the upstream call and hand back the still-unread response."""
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
            resp = urllib.request.urlopen(req, timeout=PROXY_TIMEOUT)
            return resp.status, resp.headers.get("content-type", "application/json"), resp
        except urllib.error.HTTPError as e:
            # Pass provider error responses (401/429/…) through with their body.
            return e.code, e.headers.get("content-type", "application/json"), e

    try:
        status, ctype, resp = await asyncio.to_thread(_open)
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})

    async def relay():
        # read1() hands back whatever one socket read produced; plain read(n)
        # blocks until it has all n bytes, which would re-buffer the stream and
        # stall a chat reply until the model finished. Runs off the event loop.
        try:
            while True:
                chunk = await asyncio.to_thread(resp.read1, 65536)
                if not chunk:
                    break
                yield chunk
        finally:
            await asyncio.to_thread(resp.close)

    # Only content-type is forwarded — the body is relayed as received, so
    # passing on content-length/content-encoding could contradict it.
    return StreamingResponse(
        relay(),
        status_code=status,
        media_type=ctype,
        headers={"cache-control": "no-cache, no-transform", "x-accel-buffering": "no"},
    )


if PROXY_ENABLED:
    app.post("/proxy")(proxy)


# -- serve SPA (optional) ------------------------------------------------
# When installed as a tool (uv/pip), there is no bundled frontend — users open
# the GitHub Pages site instead, which talks to this backend over /api/*.
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="spa")


# -- parent watchdog ------------------------------------------------------
def _pid_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        # PROCESS_QUERY_LIMITED_INFORMATION — succeeds even across integrity
        # levels, unlike the broader access rights.
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _start_parent_watchdog() -> None:
    """
    Exit when whatever launched us does.

    The desktop shell spawns this backend, and BabelDOC in turn runs as its
    child — so the app being force-quit or crashing would otherwise strand both,
    holding the port and, mid-translation, a few hundred MB. Polling the parent
    is the only check that still works when the app dies without a chance to run
    any cleanup of its own.
    """
    raw = os.environ.get("PDFT_PARENT_PID", "")
    if not raw.isdigit():
        return
    parent = int(raw)

    def loop() -> None:
        while True:
            time.sleep(5)
            if _pid_alive(parent):
                continue
            # Kill babeldoc explicitly first: it is the expensive one, and on
            # Windows nothing else would reap it.
            _terminate_child()
            if os.name != "nt":
                # We run in our own process group, so this catches anything the
                # explicit kill missed.
                with contextlib.suppress(Exception):
                    os.killpg(os.getpgid(0), signal.SIGTERM)
            os._exit(1)

    threading.Thread(target=loop, daemon=True, name="parent-watchdog").start()


def main():
    import uvicorn

    port = int(os.environ.get("PORT", 8787))
    # Printed here rather than at import: uvicorn re-imports this module, and on
    # a Windows console defaulting to cp936 the non-ASCII banner raises inside
    # the import — killing the backend before uvicorn ever starts, with nothing
    # useful in the log.
    with contextlib.suppress(Exception):
        where = "后端 + 前端" if STATIC_DIR.is_dir() else "后端"
        print(f"\n✓ {where}已就绪：http://127.0.0.1:{port}")
    _start_parent_watchdog()
    # uvicorn shuts down gracefully on SIGTERM, which gets us here — but it
    # knows nothing about babeldoc, so a translation in flight would otherwise
    # keep running after the app that asked for it is gone.
    atexit.register(_terminate_child)
    uvicorn.run("pdftranslate_backend:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    main()
