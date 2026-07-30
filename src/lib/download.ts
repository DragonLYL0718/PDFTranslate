import { getPlatform } from "@/platform";

/** Save bytes to disk: an anchor download in the browser, a native save dialog in the shell. */
export function downloadBlob(bytes: Uint8Array, filename: string, mime = "application/pdf"): Promise<void> {
  return getPlatform().saveFile(bytes, filename, mime);
}
