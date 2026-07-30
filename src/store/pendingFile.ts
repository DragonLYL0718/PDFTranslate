import { create } from "zustand";

export interface IncomingFile {
  name: string;
  data: ArrayBuffer;
}

interface PendingFileState {
  /** A PDF the OS handed us via the file association, awaiting import. */
  file: IncomingFile | null;
  offer: (file: IncomingFile) => void;
  take: () => IncomingFile | null;
}

/**
 * Bridges "open with PDFTranslate" into the normal import flow. The shell can
 * deliver a file at any moment, including while the reader is open, so it is
 * parked here rather than pushed at whichever screen happens to be mounted.
 */
export const usePendingFile = create<PendingFileState>((set, get) => ({
  file: null,
  offer: (file) => set({ file }),
  take: () => {
    const { file } = get();
    if (file) set({ file: null });
    return file;
  },
}));
