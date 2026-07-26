import Dexie, { type EntityTable } from "dexie";
import type {
  Annotation,
  AppSettings,
  DocPage,
  DocRecord,
  Glossary,
  MemoryRecord,
  Provider,
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

/** Delete a document plus its pages, annotations and auto-extracted glossary/terms. */
export async function deleteDocument(docId: string): Promise<void> {
  await db.transaction(
    "rw",
    db.documents,
    db.pages,
    db.glossaries,
    db.terms,
    db.annotations,
    async () => {
      await db.pages.where("docId").equals(docId).delete();
      await db.annotations.where("docId").equals(docId).delete();
      const autoGlossaries = await db.glossaries.where("docId").equals(docId).toArray();
      for (const g of autoGlossaries) await db.terms.where("glossaryId").equals(g.id).delete();
      await db.glossaries.where("docId").equals(docId).delete();
      await db.documents.delete(docId);
    },
  );
}
