// Stage the backend's source as a Tauri app resource, so the shell can install
// it with `uv tool install <path>` instead of a git URL.
//
// Why a local path rather than `git+https://…#subdirectory=backend`:
//   - git is not installed by default on Windows, so the git spec fails on a
//     clean machine — the exact machine this whole feature exists for.
//   - a git spec tracks `main`, which drifts from the frontend it shipped with.
//   - AGPL-3.0: shipping the backend's complete corresponding source inside the
//     bundle is the most conservative way to satisfy it. (BabelDOC itself is
//     still fetched from PyPI by the user's own machine, never redistributed.)
//
// Copies an explicit allowlist: the working tree can contain a built `dist/`
// copy of the SPA, __pycache__ and *.egg-info, none of which belong in a wheel.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "backend");
const DEST = join(ROOT, "src-tauri", "resources", "backend");

/** Everything uv needs to build the wheel, and the licence it ships under. */
const INCLUDE = ["pyproject.toml", "README.md", "LICENSE", "pdftranslate_backend"];

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

for (const name of INCLUDE) {
  const from = join(SRC, name);
  if (!existsSync(from)) {
    // LICENSE and README are nice-to-have; the build inputs are not.
    if (name === "pyproject.toml" || name === "pdftranslate_backend") {
      throw new Error(`backend/${name} is missing — cannot stage the backend`);
    }
    console.warn(`  skipped backend/${name} (not present)`);
    continue;
  }
  cpSync(from, join(DEST, name), {
    recursive: true,
    filter: (p) => !/(__pycache__|\.egg-info|\.pyc$)/.test(p),
  });
  console.log(`  staged backend/${name}`);
}
