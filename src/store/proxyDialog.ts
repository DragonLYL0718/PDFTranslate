import { create } from "zustand";

interface ProxyDialogState {
  open: boolean;
  reason?: string;
  show: (reason?: string) => void;
  hide: () => void;
}

/** Global control for the "set up local proxy" dialog (opened on likely-CORS failures). */
export const useProxyDialog = create<ProxyDialogState>((set) => ({
  open: false,
  show: (reason) => set({ open: true, reason }),
  hide: () => set({ open: false }),
}));
