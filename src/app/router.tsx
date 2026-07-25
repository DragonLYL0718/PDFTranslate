import { createBrowserRouter, Navigate } from "react-router-dom";
import { RootShell } from "./RootShell";
import { Layout } from "./Layout";
import { LibraryPage } from "@/features/history/LibraryPage";
import { ReaderPage } from "@/features/reader/ReaderPage";
import { GlossaryPage } from "@/features/glossary/GlossaryPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

// Base path matches Vite's `base` so GitHub Pages project sites route correctly.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

export const router = createBrowserRouter(
  [
    {
      element: <RootShell />,
      children: [
        {
          path: "/",
          element: <Layout />,
          children: [
            { index: true, element: <LibraryPage /> },
            { path: "glossary", element: <GlossaryPage /> },
            { path: "settings", element: <SettingsPage /> },
            { path: "*", element: <Navigate to="/" replace /> },
          ],
        },
        // Reader is full-bleed, outside the sidebar layout.
        { path: "/reader/:id", element: <ReaderPage /> },
      ],
    },
  ],
  { basename: basename || undefined },
);
