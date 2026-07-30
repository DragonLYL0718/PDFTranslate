import type { Platform } from "./index";

/** Browser: downloads go through an anchor click, links open in a new tab. */
export function create(): Platform {
  return {
    kind: "web",
    // Browser fetch obeys CORS, so smartFetch keeps its local-relay fallback.
    nativeFetch: null,

    async saveFile(bytes, filename, mime) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },

    async openExternal(url) {
      window.open(url, "_blank", "noopener");
    },
  };
}
