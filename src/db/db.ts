import Dexie, { type EntityTable } from "dexie";
import type {
  Annotation,
  AppSettings,
  ChatMessage,
  ChatSession,
  DocPage,
  DocRecord,
  Glossary,
  MemoryRecord,
  Provider,
  RagEmbeddings,
  RagIndex,
  Term,
} from "@/types";

// Local-first store. Everything lives in the browser; nothing is uploaded.
class PDFTranslateDB extends Dexie {
  documents!: EntityTable<DocRecord, "id">;
  pages!: EntityTable<DocPage, "id">;
  providers!: EntityTable<Provider, "id">;
  settings!: EntityTable<AppSettings, "id">;
  glossaries!: EntityTable<Glossary, "id">;
  terms!: EntityTable<Term, "id">;
  memory!: EntityTable<MemoryRecord, "id">;
  annotations!: EntityTable<Annotation, "id">;
  chatMessages!: EntityTable<ChatMessage, "id">;
  chatSessions!: EntityTable<ChatSession, "id">;
  chatIndexes!: EntityTable<RagIndex, "docId">;
  chatEmbeddings!: EntityTable<RagEmbeddings, "docId">;

  constructor() {
    super("pdftranslate");
    this.version(1).stores({
      documents: "id, createdAt, status",
      pages: "id, docId, pageNumber",
      providers: "id, order, enabled",
      settings: "id",
    });
    this.version(2).stores({
      glossaries: "id, kind, docId, createdAt",
      terms: "id, glossaryId, source, origin",
      memory: "id, createdAt",
    });
    this.version(3).stores({
      annotations: "id, docId, pageNumber, createdAt",
    });
    // The whole search index lives in one row per document: BM25 scores against
    // every posting anyway, so a row per chunk would just mean N reads per query.
    this.version(4).stores({
      chatMessages: "id, docId, createdAt",
      chatIndexes: "docId",
    });
    // Separate table: a 300-chunk document's vectors are ~1.8 MB, and a
    // keyword-only user must never pay to read them alongside the index.
    this.version(5).stores({
      chatEmbeddings: "docId",
    });
    // Chat becomes multi-session. Existing messages predate sessionId, so they
    // are gathered into one session per document rather than orphaned — a
    // reader who already has a conversation open must still find it.
    this.version(6)
      .stores({
        chatMessages: "id, docId, sessionId, createdAt",
        chatSessions: "id, docId, updatedAt",
      })
      .upgrade(async (tx) => {
        const byDoc = new Map<string, ChatMessage[]>();
        for (const m of await tx.table<ChatMessage>("chatMessages").toArray()) {
          byDoc.set(m.docId, [...(byDoc.get(m.docId) ?? []), m]);
        }
        for (const [docId, rows] of byDoc) {
          const sessionId = crypto.randomUUID();
          const times = rows.map((r) => r.createdAt);
          await tx.table<ChatSession>("chatSessions").put({
            id: sessionId,
            docId,
            title: rows.find((r) => r.role === "user")?.content.slice(0, 60) ?? "",
            createdAt: Math.min(...times),
            updatedAt: Math.max(...times),
          });
          await tx.table("chatMessages").bulkPut(rows.map((r) => ({ ...r, sessionId })));
        }
      });
  }
}

export const db = new PDFTranslateDB();

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  googleFallback: true,
  proxyEnabled: false,
  proxyUrl: "http://localhost:8788",
  babelDocUrl: "http://localhost:8787",
  memoryEnabled: true,
  autoExtractTerms: true,
  termStrictness: "standard",
  defaultGlossaryId: null,
  chatIncludeContext: true,
  chatSummaryPrompts: {},
  chatContextChunks: 6,
  chatSuggestions: true,
  chatStreaming: true,
  chatPanelWidth: 400,
  autoFitWidth: true,
  chatEmbeddingsEnabled: false,
  chatEmbeddingModel: "text-embedding-3-small",
  lastOptions: {
    sourceLang: "auto",
    targetLang: "zh",
    engine: "heuristic",
    providerId: null,
    viewMode: "split",
  },
};

/** Read app settings (pure read — safe inside a liveQuery). Backfills new defaults. */
export async function readSettings(): Promise<AppSettings> {
  let existing = await db.settings.get("app");
  if (existing) {
    // Migrate old default proxy URL (8787 → 8788) so it doesn't conflict with BabelDOC.
    if (existing.proxyUrl === "http://localhost:8787") {
      existing = { ...existing, proxyUrl: "http://localhost:8788" };
    }
    return { ...DEFAULT_SETTINGS, ...existing };
  }
  return DEFAULT_SETTINGS;
}

export async function patchSettings(patch: Partial<Omit<AppSettings, "id">>): Promise<void> {
  let current = { ...DEFAULT_SETTINGS, ...(await db.settings.get("app")) };
  // Apply the same migration in write path.
  if (current.proxyUrl === "http://localhost:8787") {
    current = { ...current, proxyUrl: "http://localhost:8788" };
  }
  await db.settings.put({ ...current, ...patch, id: "app" });
}

/** Delete a document plus its pages, annotations, chat, index and auto-extracted terms. */
export async function deleteDocument(docId: string): Promise<void> {
  // Array form: the variadic overload tops out below the number of tables here.
  await db.transaction(
    "rw",
    [db.documents, db.pages, db.glossaries, db.terms, db.annotations, db.chatMessages, db.chatSessions, db.chatIndexes, db.chatEmbeddings],
    async () => {
      await db.pages.where("docId").equals(docId).delete();
      await db.annotations.where("docId").equals(docId).delete();
      await db.chatMessages.where("docId").equals(docId).delete();
      await db.chatSessions.where("docId").equals(docId).delete();
      await db.chatIndexes.delete(docId);
      await db.chatEmbeddings.delete(docId);
      const autoGlossaries = await db.glossaries.where("docId").equals(docId).toArray();
      for (const g of autoGlossaries) await db.terms.where("glossaryId").equals(g.id).delete();
      await db.glossaries.where("docId").equals(docId).delete();
      await db.documents.delete(docId);
    },
  );
}
