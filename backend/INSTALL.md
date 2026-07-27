# BabelDOC Backend Installation Guide

PDFTranslate's high-fidelity engine (Engine B) requires a local Python backend.

## Usage Modes

There are two ways to use PDFTranslate:

### Option 1: Fully local deployment (backend + frontend)
- Frontend runs locally: `npm run dev`, or served by the backend
- Backend runs locally: `python -m pdftranslate_backend`
- Visit: http://localhost:8787

### Option 2: GitHub Pages frontend + local backend (recommended for users)
- Frontend on GitHub Pages: https://dragonlyl0718.github.io/PDFTranslate
- Backend runs locally: `python -m pdftranslate_backend`
- The frontend auto-discovers the local backend

## Prerequisites

- **Python 3.12+** (or system Python 3.10+)
- **uv** or **pip**

## Quick Start (recommended: with uv, no repo clone needed)

**Step 1: Install BabelDOC** (provides the `babeldoc` command)
```bash
uv tool install --python 3.12 BabelDOC
babeldoc --version   # verify
```

**Step 2: Install the backend** (provides the `pdftranslate-backend` command)
```bash
uv tool install --python 3.12 "git+https://github.com/DragonLYL0718/PDFTranslate.git#subdirectory=backend"
```

**Step 3: Start it**
```bash
pdftranslate-backend
```

That's it! The backend will run at `http://localhost:8787`. After the first setup, you only need to run `pdftranslate-backend` again.

> No uv? Install it first (restart your terminal afterwards): `curl -LsSf https://astral.sh/uv/install.sh | sh`

### One-line script (optional, requires Node.js)

If Node.js is already installed, you can run the single command provided by the in-app "Install BabelDOC" dialog to automate the steps above.

### Developing from source

If you cloned the repo to modify the code:
```bash
uv pip install -e ./backend
python -m pdftranslate_backend
```

## Verification

On a successful start, you should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8787
```

### Check that the backend is running

```bash
curl http://localhost:8787/api/health
```

Expected response:
```json
{
  "ok": true,
  "name": "pdftranslate-backend",
  "version": "0.1.0",
  "babeldoc": "babeldoc 0.6.4"
}
```

### Access the PDFTranslate frontend

**Option 1: Fully local deployment**
- Visit http://localhost:8787 (the backend serves the frontend automatically)

**Option 2: GitHub Pages (recommended for users)**
- Visit https://dragonlyl0718.github.io/PDFTranslate/
- The frontend will auto-discover the local backend
- Select the "High Fidelity (BabelDOC)" engine to start translating

## Troubleshooting

### ❌ "BabelDOC command not available"

```bash
# 1. Check whether it's installed
which babeldoc

# 2. Verify the Python environment
python -m site

# 3. Restart your terminal (required)
# Close all terminal windows and reopen them
```

**macOS/Linux users**: you may need to add uv's bin directory to your PATH. The installer will prompt you if so.

### ❌ "Failed to connect to backend"

Checklist:
1. **Is the backend running?**
   ```bash
   curl http://localhost:8787/api/health
   ```

2. **Is the frontend built?**
   ```bash
   # Check whether the dist/ directory exists
   ls dist/
   ```
   If not, run `npm run build`

3. **Is BabelDOC installed?**
   ```bash
   babeldoc --version
   ```

4. **Check the backend's error log**
   - The backend should print the BabelDOC version on startup
   - If it shows "⚠️ frontend files not found", run `npm run build` and restart

### ❌ Backend unreachable from the hosted (https) site only

The backend answers `curl` and works from `http://localhost:5173`, but the
GitHub Pages site reports "can't reach the backend". An https page calling
`http://localhost` is a *private network* request, and browsers guard it:

1. **Upgrade the backend.** It must answer the browser's private-network
   preflight with `Access-Control-Allow-Private-Network: true` (needs
   `starlette >= 0.51`). Reinstall and restart:
   ```bash
   uv tool install --force --python 3.12 "git+<repo>.git#subdirectory=backend"
   ```
   Verify — the last header must be present:
   ```bash
   curl -i -X OPTIONS http://localhost:8787/api/health \
     -H "Origin: https://<your-site>" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Private-Network: true"
   ```

2. **Restart after changing the origin allowlist.** `ALLOWED_ORIGIN_REGEX`
   is read at import time, so a backend started before the change still
   rejects the new origin.

3. **Safari can't do this at all.** It blocks https → `http://localhost` as
   mixed content, and Chrome may additionally ask for local-network
   permission. The way around it is to skip the hosted page: open
   http://localhost:8787, which the backend serves itself (same origin, no
   guard). Note that browser storage is per-origin, so that copy has its own
   separate library.

### ❌ "npm run build fails"

```bash
# 1. Clear node_modules
rm -rf node_modules
npm install

# 2. Rebuild
npm run build

# 3. Check the build output
ls -la dist/
```

### ❌ "pip install -e ./backend fails"

```bash
# Use uv instead of pip
uv pip install -e ./backend

# or upgrade pip
pip install --upgrade pip setuptools wheel
pip install -e ./backend
```

## One-line install script

Run from the PDFTranslate directory (requires Node.js):

```bash
curl -fsSL https://your-pdftranslate-url/install-babeldoc.mjs | node --input-type=module
```

This automatically:
1. Checks/installs uv
2. Installs BabelDOC
3. Builds the frontend
4. Installs the backend
5. Prints the start command

## Docker (optional)

```bash
# Build the image
docker build -t pdftranslate-backend ./backend

# Run the container
docker run -p 8787:8787 pdftranslate-backend
```

Requires the frontend to already be built into the `dist/` directory.

## File structure

```
PDFTranslate/
├── backend/
│   ├── pyproject.toml          # Backend config
│   ├── pdftranslate_backend/
│   │   └── __init__.py         # Main program
│   ├── Dockerfile              # Docker config
│   └── INSTALL.md              # This file
├── public/
│   └── install-babeldoc.mjs    # One-line install script
├── dist/                       # Frontend build output (run npm run build)
├── package.json
└── README.md
```

## Uninstalling

```bash
# Uninstall the backend package
pip uninstall pdftranslate-backend

# Uninstall BabelDOC
pip uninstall BabelDOC
uv tool uninstall BabelDOC
```

## Getting help

- [BabelDOC official repository](https://github.com/funstory-ai/BabelDOC)
- [FastAPI documentation](https://fastapi.tiangolo.com/)
- [uv documentation](https://docs.astral.sh/uv/)
