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

### Option A: Desktop app (macOS / Windows) — recommended

Download the installer for your platform from [Releases](https://github.com/DragonLYL0718/PDFTranslate/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `PDFTranslate_*_aarch64.dmg` |
| macOS (Intel) | `PDFTranslate_*_x64.dmg` |
| Windows | `PDFTranslate_*-setup.exe` |

The desktop app needs **no proxy script**: its requests go out through the native
HTTP client, so it reaches AI providers that a browser refuses by CORS. The
high-fidelity engine installs itself from inside the app — Settings → the import
dialog → **Install the high-fidelity engine**, no terminal involved.

> **These builds are not signed.** Code-signing certificates are paid, and this
> project has none, so both systems will warn you. The builds are produced by the
> public workflow in this repo and every release lists SHA-256 checksums.
>
> **macOS** says *"PDFTranslate is damaged and can't be opened"*. Fix it once:
> ```bash
> xattr -dr com.apple.quarantine /Applications/PDFTranslate.app
> ```
> Or without a terminal: double-click it, then go to **System Settings → Privacy
> & Security**, scroll down and click **Open Anyway**.
>
> **Windows** shows *"Windows protected your PC"*. Click **More info → Run anyway**.
>
> Updates installed from inside the app skip all of this — only the first install
> needs it.

### Option B: Browser only (zero installation)
- Visit the site hosted on GitHub Pages
- Uses the default browser heuristic engine
- Runs entirely in the browser, nothing to install
- CORS-blocked providers need the local proxy helper (the app prompts you)

### Option C: Browser + local BabelDOC backend (high fidelity, manual)

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

One `src/` builds all three targets. Everything that genuinely differs between
the browser and the desktop shell — reaching a provider past CORS, writing a
file, opening a link, locating the backend — sits behind `src/platform/`.

## Development

```bash
npm install
npm run dev            # web, http://localhost:5173
npm run build          # web bundle → dist/

npm run desktop        # desktop app, dev mode
npm run desktop:build  # installers → src-tauri/target/release/bundle/
```

The desktop build needs [Rust](https://rustup.rs). `npm run desktop` first runs
`prep:desktop`, which vendors the `uv` sidecar (checksum-verified against the
release's own `.sha256`) and stages `backend/` as a bundled resource.

Pushing to `main` publishes the web app to Pages. Pushing a `v*` tag builds the
desktop installers and opens a **draft** release.

### Releasing

The updater signs its manifest with a key that is independent of OS code
signing (and free). It is already configured; the private key lives outside this
repo at `~/.pdftranslate/updater.key`. Add it to the repo's GitHub secrets once:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.pdftranslate/updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""
```

Then tag a release:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

> **Back up `~/.pdftranslate/updater.key` somewhere outside CI.** Losing it means
> published apps can no longer verify updates, and every user has to reinstall
> by hand — including the Gatekeeper dance.

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

The frontend code is MIT licensed. The optional `backend/` component wraps BabelDOC and is licensed under **AGPL-3.0** ([`backend/LICENSE`](backend/LICENSE)), invoked as a separate process over a local HTTP API.

The desktop app additionally ships the `uv` binary and the backend's source. See [THIRD-PARTY.md](THIRD-PARTY.md) for what is bundled, what is downloaded onto the user's machine, and under which terms.
