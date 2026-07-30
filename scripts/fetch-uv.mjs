// Vendor the `uv` binary as a Tauri sidecar.
//
// uv is what lets the app provision Engine B without the user ever opening a
// terminal: it downloads a private Python, then installs BabelDOC and the
// backend into the app's own data directory. Shipping it rather than fetching
// it at runtime is deliberate — the download would fail for exactly the users
// who most need the one-click path.
//
//   node scripts/fetch-uv.mjs                       # host platform
//   node scripts/fetch-uv.mjs --triple x86_64-pc-windows-msvc
//   node scripts/fetch-uv.mjs --all                 # every supported triple
//
// Idempotent: a binary already present with the right hash is left alone.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pinned: a silent uv upgrade would change provisioning behaviour for every
// user at once, with no signal in this repo's history.
const UV_VERSION = "0.12.0";

const TRIPLES = {
  "aarch64-apple-darwin": { asset: "uv-aarch64-apple-darwin.tar.gz", exe: "" },
  "x86_64-apple-darwin": { asset: "uv-x86_64-apple-darwin.tar.gz", exe: "" },
  "x86_64-pc-windows-msvc": { asset: "uv-x86_64-pc-windows-msvc.zip", exe: ".exe" },
};

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "binaries");
const BASE = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;

function hostTriple() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  throw new Error(`no uv sidecar configured for ${process.platform}/${process.arch}`);
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Depth-first search for a file by name. Beats shelling out to `find`, which Windows lacks. */
function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

async function fetchOne(triple) {
  const { asset, exe } = TRIPLES[triple];
  if (!asset) throw new Error(`unknown triple: ${triple}`);
  // Tauri resolves a sidecar by appending the target triple to the configured
  // name, so the filename is load-bearing rather than cosmetic.
  const dest = join(OUT_DIR, `uv-${triple}${exe}`);

  const archive = await download(`${BASE}/${asset}`);
  // Every uv release ships a .sha256 next to each asset; verifying it is the
  // only thing standing between a bad download and a binary we then execute.
  const expected = (await download(`${BASE}/${asset}.sha256`)).toString("utf8").trim().split(/\s+/)[0];
  const actual = sha256(archive);
  if (actual !== expected) throw new Error(`checksum mismatch for ${asset}\n  expected ${expected}\n  got      ${actual}`);

  // A stamp of what we last wrote, so a re-run can skip the extraction.
  const stamp = `${dest}.sha256`;
  if (existsSync(dest) && existsSync(stamp) && sha256(readFileSync(dest)) === readFileSync(stamp, "utf8").trim()) {
    console.log(`  ${triple}: already current, skipped`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "uv-fetch-"));
  try {
    const archivePath = join(work, asset);
    writeFileSync(archivePath, archive);
    // tar and unzip are both present on macOS and on Windows 10+.
    if (asset.endsWith(".zip")) execFileSync("tar", ["-xf", archivePath, "-C", work], { stdio: "inherit" });
    else execFileSync("tar", ["-xzf", archivePath, "-C", work], { stdio: "inherit" });

    // Layout differs per archive: the tarballs nest under a directory, the zip
    // does not. Search rather than assume either.
    const found = findFile(work, `uv${exe}`);
    if (!found) throw new Error(`no uv${exe} inside ${asset}`);

    mkdirSync(OUT_DIR, { recursive: true });
    const bytes = readFileSync(found);
    writeFileSync(dest, bytes);
    writeFileSync(stamp, sha256(bytes));
    if (!exe) chmodSync(dest, 0o755);
    console.log(`  ${triple}: ${(bytes.length / 1e6).toFixed(1)} MB → ${dest}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const flag = args.indexOf("--triple");
const triples = args.includes("--all")
  ? Object.keys(TRIPLES)
  : [flag === -1 ? hostTriple() : args[flag + 1]];

console.log(`uv ${UV_VERSION}`);
for (const t of triples) await fetchOne(t);
