# SPDX-License-Identifier: AGPL-3.0-only
# PDFTranslate backend — wraps BabelDOC (AGPL-3.0) for high-fidelity PDF translation.
# Build:  docker build -t pdftranslate-backend .
# Run:    docker run --init -p 8787:8787 pdftranslate-backend

FROM python:3.12-slim

WORKDIR /app

# Install BabelDOC + runtime deps
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

# Pre-built SPA (build from repo root first: npm run build && cp -r dist backend/)
COPY dist ./dist

CMD ["pdftranslate-backend"]
