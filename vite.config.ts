import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// `base` is set via VITE_BASE for GitHub Pages project sites (e.g. "/PDFTranslate/").
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "PDFTranslate",
        short_name: "PDFTranslate",
        description: "AI PDF 翻译器 · 保持排版 · 本地优先",
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
