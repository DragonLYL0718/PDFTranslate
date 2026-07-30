import { create } from "zustand";

interface DesktopBackendState {
  /** Base URL of the app-managed backend, or null when it isn't running. */
  url: string | null;
  setUrl: (url: string | null) => void;
}

/**
 * The managed backend's address, kept in sync with the Rust side (which picks a
 * free port rather than a fixed one, so two instances can't collide). Always
 * null on the web, where the user configures the address themselves.
 */
export const useDesktopBackend = create<DesktopBackendState>((set) => ({
  url: null,
  setUrl: (url) => set({ url }),
}));
