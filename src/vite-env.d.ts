/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "desktop" in the Tauri shell build (.env.desktop); unset on the web. */
  readonly VITE_TARGET?: string;
  /** Repo the BabelDOC backend is installed from. Overridable by forks. */
  readonly VITE_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
