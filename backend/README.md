# PDFTranslate Backend

Local backend for [PDFTranslate](https://github.com/DragonLYL0718/PDFTranslate) — enables high-fidelity PDF translation using [BabelDOC](https://github.com/funstory-ai/BabelDOC).

## Quick Start

### 1. Install BabelDOC
```bash
uv tool install --python 3.12 BabelDOC
```

### 2. Install and run the backend
```bash
pip install pdftranslate-backend
python -m pdftranslate_backend
```

Backend starts at `http://localhost:8787`

### 3. Use with PDFTranslate
- **GitHub Pages**: https://dragonlyl0718.github.io/PDFTranslate/
- **Local**: http://localhost:8787

Select "高保真（BabelDOC）" engine in the app.

## Installation Methods

### From PyPI (recommended)
```bash
pip install pdftranslate-backend
```

### From source
```bash
git clone https://github.com/DragonLYL0718/PDFTranslate.git
cd PDFTranslate
pip install -e ./backend
```

### With uv
```bash
uv pip install pdftranslate-backend
# or from source
uv pip install -e ./backend
```

## Configuration

Backend listens on `http://127.0.0.1:8787` by default.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `BABELDOC_QPS` | `4` | LLM requests/second. Lower it if the reader warns that paragraphs failed — BabelDOC drops any paragraph whose call was rate-limited, leaving blanks in the PDF. |
| `BABELDOC_TIMEOUT` | `1800` | Seconds before a translation job is aborted. |

```bash
PORT=9999 BABELDOC_QPS=1 python -m pdftranslate_backend
```

## Architecture

- **FastAPI** HTTP server with CORS enabled for GitHub Pages
- **Uvicorn** ASGI application server
- **BabelDOC** integration: accepts PDF uploads, returns translated PDFs
- **Optional SPA**: serves PDFTranslate frontend if built (`dist/` present)

## How It Works

1. Frontend (browser/GitHub Pages) uploads PDF + language settings
2. Backend calls BabelDOC command-line tool
3. BabelDOC processes PDF with AI translation
4. Backend returns translated PDF to frontend
5. Frontend stores result in browser's IndexedDB

All data stays on your device. No cloud storage.

## License

AGPL-3.0 (because it wraps BabelDOC which is AGPL-3.0)

If you use PDFTranslate backend in an application, your source code must be open under AGPL-3.0 or compatible license.

## Documentation

- [Installation Guide](INSTALL.md)
- [PDFTranslate Main Repository](https://github.com/DragonLYL0718/PDFTranslate)
- [BabelDOC Repository](https://github.com/funstory-ai/BabelDOC)
