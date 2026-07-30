// Platform adapter: one `src/` serves both the hosted web app and the Tauri
// desktop shell. Everything that genuinely differs between them — reaching a
// provider past CORS, writing a file, opening a link — lives behind this
// interface so the feature code stays target-agnostic.

import { setNativeFetch } from "@/features/providers/net";

export interface Platform {
  readonly kind: "web" | "desktop";
  /**
   * A fetch that isn't subject to the same-origin policy, or null when the
   * browser's rules apply and a CORS-blocked provider still needs a relay.
   */
  readonly nativeFetch: typeof fetch | null;
  /** Persist bytes where the user asks. Resolves silently if they cancel. */
  saveFile(bytes: Uint8Array, filename: string, mime: string): Promise<void>;
  /** Open a URL outside the app (system browser). */
  openExternal(url: string): Promise<void>;
}

/**
 * Build-time constant: Vite substitutes it literally, so the branch below folds
 * away and the unused implementation is dropped from the bundle.
 */
export const isDesktop = import.meta.env.VITE_TARGET === "desktop";

let current: Platform | null = null;

export function getPlatform(): Platform {
  if (!current) throw new Error("getPlatform() called before initPlatform()");
  return current;
}

/**
 * Resolve the implementation and wire it into the network layer. Runs before
 * the first render (see src/main.tsx) so nothing can observe a half-configured
 * app. The implementations are reached via dynamic import() because Vite only
 * constant-folds `import.meta.env` for those — a static import of ./desktop
 * would drag every @tauri-apps package into the web bundle.
 */
export async function initPlatform(): Promise<void> {
  if (isDesktop) {
    try {
      current = await (await import("./desktop")).create();
    } catch (e) {
      // Rendering happens after this resolves, so a shell that fails to wire up
      // would otherwise leave a blank window with nothing to go on. Degrading to
      // browser behaviour keeps the app usable and lets errors surface normally.
      console.error("desktop platform init failed; falling back to web", e);
      current = (await import("./web")).create();
    }
  } else {
    current = (await import("./web")).create();
  }
  setNativeFetch(current.nativeFetch);
}
