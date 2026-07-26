import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// `base` is set via VITE_BASE for GitHub Pages project sites (e.g. "/PDFTranslate/").
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  // All app data lives in IndexedDB, which is scoped per origin. Falling back to
  // another port on a conflict would silently hand the app an empty database
  // (documents, glossaries and settings all appear wiped), so fail loudly instead.
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "PDFTranslate",
        short_name: "PDFTranslate",
        // Build-time, so it can't follow the UI language; English reaches the most people.
        description: "AI PDF translator · layout preserved · local-first",
        theme_color: "#0f1821",
        background_color: "#061118",
        display: "standalone",
        icons: [
          {
            src: `${base}favicon.svg`,
            sizes: "32x32",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2,ttf}"],
        // The bundled CJK export font is fetched lazily (only when exporting)
        // and exceeds Workbox's default 2 MiB precache limit — exclude it
        // from install-time precaching. The runtimeCaching rule below still
        // caches it (CacheFirst) the first time it's actually fetched.
        globIgnores: ["**/*.ttf"],
        runtimeCaching: [
          {
            urlPattern: /\.(?:ttf|woff2)$/,
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 10, maxAgeSeconds: 86400 * 30 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  optimizeDeps: {
    // These are only reachable via dynamic import() (export/OCR code-split
    // chunks), so Vite's cold-start scanner misses them. Without this,
    // the *first* export/OCR triggers a dep re-optimization + full reload
    // mid-request, which races the in-flight import() and throws
    // "Failed to fetch dynamically imported module".
    include: ["pdf-lib", "@pdf-lib/fontkit", "tesseract.js"],
  },
});
