import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { t } from "@/i18n";
import { useDesktopBackend } from "@/store/desktopBackend";
import { usePendingFile } from "@/store/pendingFile";
import type { Platform } from "./index";

interface BackendStatus {
  running: boolean;
  url: string | null;
}

/**
 * Track the managed backend's address. The initial read happens before the
 * first render, and the event covers the rest — the backend is started off the
 * critical path, so its port usually arrives a second or two later.
 */
async function trackBackend(): Promise<void> {
  void listen<BackendStatus>("backend://status", (e) => {
    useDesktopBackend.getState().setUrl(e.payload.url);
  });
  try {
    const status = await invoke<BackendStatus>("engine_b_backend_status");
    useDesktopBackend.getState().setUrl(status.url);
  } catch {
    // Not fatal: the event will deliver the address once it is up.
  }
}

/**
 * Route links marked target="_blank" to the system browser. The webview has no
 * tabs or address bar, so the default behaviour strands the user in a chromeless
 * window. One capture listener covers every link in the app — including the
 * chat's rendered Markdown — without touching a single call site.
 */
function interceptExternalLinks(): void {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const a = target.closest<HTMLAnchorElement>('a[target="_blank"]');
      // Only real web links; blob:/data: anchors are in-app downloads.
      if (!a || !/^https?:/i.test(a.href)) return;
      e.preventDefault();
      void openUrl(a.href);
    },
    true,
  );
}

/**
 * Accept PDFs the OS sends us through the .pdf file association.
 *
 * Rust hands over paths; the bytes are fetched separately so a large PDF never
 * crosses the IPC bridge as a JSON number array.
 */
function acceptOpenedFiles(): void {
  void listen<string[]>("app://open-files", async (e) => {
    // One document at a time — the import dialog only offers options for one.
    const path = e.payload[0];
    if (!path) return;
    try {
      const data = await invoke<ArrayBuffer>("read_file_bytes", { path });
      const name = path.split(/[\\/]/).pop() ?? "document.pdf";
      usePendingFile.getState().offer({ name, data });
    } catch (err) {
      console.error("could not open the file the system sent", err);
    }
  });
}

/**
 * Offer an update when one is published.
 *
 * This carries more weight here than it usually would: the app ships unsigned,
 * so every manually downloaded release makes the user clear Gatekeeper by hand.
 * A bundle replaced by the updater never gets a quarantine attribute, so only
 * the very first install needs that.
 */
async function offerUpdate(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    if (!confirm(t("update.available", { version: update.version }))) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch {
    // Offline, or nothing published yet — never worth interrupting startup.
  }
}

/** Tauri shell: native HTTP (no CORS), native save dialog, system browser. */
export async function create(): Promise<Platform> {
  interceptExternalLinks();
  acceptOpenedFiles();
  await trackBackend();
  // Deliberately not awaited: a slow or unreachable update endpoint must never
  // hold up the first render.
  void offerUpdate();

  return {
    kind: "desktop",
    // Rust-side HTTP: no same-origin policy, so no provider ever needs a relay.
    nativeFetch: httpFetch as typeof fetch,

    // `mime` is unused here: the extension the user keeps in the save dialog
    // is what decides the file's type on disk.
    async saveFile(bytes, filename, _mime) {
      const ext = filename.split(".").pop() ?? "";
      const path = await save({
        defaultPath: filename,
        filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
      });
      if (!path) return; // user cancelled the dialog
      await writeFile(path, bytes);
    },

    async openExternal(url) {
      await openUrl(url);
    },
  };
}
