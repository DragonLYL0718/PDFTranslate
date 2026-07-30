import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { initI18n, useLocale } from "@/i18n";
import { initPlatform } from "@/platform";
import { router } from "./app/router";
import "./styles/global.css";

// Resolve the UI language before the first render so nothing flashes.
initI18n();

/** Remounting on locale change is the whole re-render story — see src/i18n. */
function App() {
  return <RouterProvider key={useLocale()} router={router} />;
}

// Pick the web/desktop implementation and wire it into the network layer before
// anything renders, so no request can go out through the wrong one.
initPlatform().then(() => {
  // Remove the no-transition guard once the app has mounted.
  requestAnimationFrame(() => document.body.classList.remove("preload"));
  document.body.classList.add("preload");

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
