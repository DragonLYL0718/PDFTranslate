import { create } from "zustand";

interface BabelDocDialogState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** Global control for the "install BabelDOC" dialog. Opened from ImportDialog when engine B is unavailable. */
export const useBabelDocDialog = create<BabelDocDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
