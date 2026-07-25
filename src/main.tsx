import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import "./styles/global.css";

// Remove the no-transition guard once the app has mounted.
requestAnimationFrame(() => document.body.classList.remove("preload"));
document.body.classList.add("preload");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
