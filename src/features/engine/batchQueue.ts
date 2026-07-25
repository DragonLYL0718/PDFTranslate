import { create } from "zustand";
import { runTranslationJob, type JobOptions } from "@/features/engine/runJob";

interface QueueItem {
  docId: string;
  status: "waiting" | "running" | "done" | "error";
  error?: string;
}

interface BatchState {
  queue: QueueItem[];
  running: boolean;
  /** Add documents to the translation queue. */
  enqueue: (docIds: string[]) => void;
  /** Start processing the queue (no-op if already running). Needs to be called explicitly. */
  process: (options: JobOptions) => void;
  /** Remove all completed items from view. */
  clearDone: () => void;
  /** Total progress across all items. */
  progress: (totalCount: number) => number;
  getQueue: () => QueueItem[];
}

export const useBatchQueue = create<BatchState>((set, get) => ({
  queue: [],
  running: false,

  enqueue: (docIds) => {
    set((s) => ({
      queue: [
        ...s.queue,
        ...docIds.map((docId) => ({ docId, status: "waiting" as const })),
      ],
    }));
  },

  process: async (options) => {
    if (get().running) return;
    set({ running: true });

    while (true) {
      const next = get().queue.find((q) => q.status === "waiting");
      if (!next) break;

      set((s) => ({
        queue: s.queue.map((q) => (q.docId === next.docId ? { ...q, status: "running" as const } : q)),
      }));

      try {
        await runTranslationJob(next.docId, options);
        set((s) => ({
          queue: s.queue.map((q) => (q.docId === next.docId ? { ...q, status: "done" as const } : q)),
        }));
      } catch (e) {
        set((s) => ({
          queue: s.queue.map((q) =>
            q.docId === next.docId ? { ...q, status: "error" as const, error: String(e) } : q,
          ),
        }));
      }
    }

    set({ running: false });
  },

  clearDone: () => {
    set((s) => ({ queue: s.queue.filter((q) => q.status !== "done") }));
  },

  progress: (totalCount) => {
    const q = get().queue;
    const done = q.filter((i) => i.status === "done").length;
    return totalCount > 0 ? done / totalCount : 0;
  },

  getQueue: () => get().queue,
}));
