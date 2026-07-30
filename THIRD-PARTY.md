# Third-party components

What the distributed desktop app contains beyond this project's own code, and
under what terms. The web build ships none of the binaries listed here.

## Bundled in the installer

| Component | Version | License | Notes |
|---|---|---|---|
| [uv](https://github.com/astral-sh/uv) | pinned in `scripts/fetch-uv.mjs` | MIT OR Apache-2.0 | Shipped verbatim as a sidecar binary. Used to install the high-fidelity engine into the app's own data directory. |
| PDFTranslate backend (`backend/`) | same as the app | **AGPL-3.0-only** | Complete source, bundled as an app resource. Licence text: [`backend/LICENSE`](backend/LICENSE). |

The backend's source is bundled *as source* — which is also how its AGPL
obligation is met most directly. It runs as a separate process reachable only
over a local HTTP API; the app's own code is MIT and communicates with it across
that boundary.

## Downloaded onto the user's machine, never redistributed

Installing the high-fidelity engine makes the user's own machine fetch these
from their upstream sources. This project does not host or redistribute them.

| Component | License | Source |
|---|---|---|
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) | AGPL-3.0 | PyPI |
| CPython 3.12 | PSF | [python-build-standalone](https://github.com/astral-sh/python-build-standalone) |
| BabelDOC's dependency tree (pymupdf, onnxruntime, …) | various | PyPI |

BabelDOC also downloads its document-layout model on first run.

## Frontend dependencies

Bundled into the JavaScript, in both the web and desktop builds. See the
acknowledgements table in [README.md](README.md) for the full list — pdf.js
(Apache-2.0), pdf-lib (MIT), Dexie.js (Apache-2.0), React (MIT), Tauri
(MIT OR Apache-2.0), and others.

The CJK export font (`src/assets/fonts/NotoSansSC-Regular.ttf`) is licensed
under the SIL Open Font License 1.1.
