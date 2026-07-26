# PDFTranslate

An AI-powered **PDF translator**, local-first and browser-only.

> This entire project was written by [Claude Code](https://claude.com/claude-code).

## Features

- 📄 Multiple import methods: click / drag & drop / URL / local file; optional page range selection
- 🌐 Auto-detect or manually pick the source language, translate into any target language
- 🧩 Layout-preserving translation (BabelDOC): text blocks are re-overlaid in place, with side-by-side / target-only / source-only views
- 📚 Glossary: both engines auto-extract proper nouns during translation; terms can be routed to a chosen glossary (including a default one), edited, and regenerated per region
- 💾 Translation memory cache: identical segments aren't re-translated, saving cost and time (clearable in Settings)
- 🔌 Configure multiple AI providers (OpenAI-compatible / Claude / Gemini …), with free Google Translate as a fallback
- 📝 Export as source / translation-only / bilingual PDF

## Usage

### Option A: Browser engine only (zero configuration)
- Visit the site hosted on GitHub Pages
- Uses the default browser heuristic engine
- Runs entirely in the browser, nothing to install

### Option B: Add the local BabelDOC backend (high fidelity)

Install with [uv](https://docs.astral.sh/uv/), no need to clone the repo:

```bash
# 1. Install BabelDOC (isolated Python 3.12, provides the `babeldoc` command)
uv tool install --python 3.12 BabelDOC

# 2. Install the backend (provides the `pdftranslate-backend` command)
uv tool install --python 3.12 "git+https://github.com/DragonLYL0718/PDFTranslate.git#subdirectory=backend"

# 3. Start the backend (keep it running)
pdftranslate-backend
```

Then open the GitHub Pages site, click "Test Connection" in the "Install BabelDOC" dialog, and once it succeeds, select the "High Fidelity (BabelDOC)" engine. After the first setup, you only need to run `pdftranslate-backend` again.

> The in-app "Install BabelDOC" dialog auto-fills the repo URL above based on your deployment address.

See [`backend/INSTALL.md`](backend/INSTALL.md) for details.

## Architecture

- **Engine A (browser heuristic)**: PDF.js + an AI LLM, deployed on GitHub Pages, no setup required.
- **Engine B (high-fidelity BabelDOC)**: an optional local Python backend (AGPL-3.0) that gives the best layout preservation.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output in dist/
```

Pushing to `main` triggers a GitHub Actions build that publishes to Pages.

## Open Source Acknowledgements

This project is built on top of these open source projects:

| Project | Description | License |
|---|---|---|
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) | Optional high-fidelity translation backend (Engine B) | AGPL-3.0 |
| [pdf.js](https://github.com/mozilla/pdf.js) | PDF parsing and rendering in the browser | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | PDF creation and export | MIT |
| [Dexie.js](https://github.com/dexie/Dexie.js) | IndexedDB wrapper for local-first data storage | Apache-2.0 |
| [tesseract.js](https://github.com/naptha/tesseract.js) | OCR for scanned PDFs | Apache-2.0 |
| [franc](https://github.com/wooorm/franc) | Natural language detection | MIT |
| [React](https://github.com/facebook/react) | UI framework | MIT |
| [Vite](https://github.com/vitejs/vite) | Build tooling and dev server | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | Styling | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | Minimal state management | MIT |

## License

The frontend code is MIT licensed. The optional `backend/` component wraps BabelDOC and is licensed under **AGPL-3.0**, invoked as a separate process over a local HTTP API.
