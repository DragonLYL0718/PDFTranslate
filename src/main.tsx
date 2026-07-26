import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { initI18n, useLocale } from "@/i18n";
import { router } from "./app/router";
import "./styles/global.css";

// Resolve the UI language before the first render so nothing flashes.
initI18n();

// Remove the no-transition guard once the app has mounted.
requestAnimationFrame(() => document.body.classList.remove("preload"));
document.body.classList.add("preload");

/** Remounting on locale change is the whole re-render story — see src/i18n. */
function App() {
  return <RouterProvider key={useLocale()} router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
