import { db } from "@/db/db";
import type { DocRecord, EngineId, LangCode } from "@/types";
import { loadDocument } from "@/features/pdf/pdf";
import { extractPage } from "@/features/pdf/pdf";
import { detectLang } from "./languages";

/** Load a PDF just enough to know its page count and a language sample. */
export async function probePdf(data: ArrayBuffer): Promise<{ pageCount: number; detected: LangCode }> {
  const pdf = await loadDocument(data);
  const pageCount = pdf.numPages;
  let detected: LangCode = "auto";
  try {
    const first = await extractPage(pdf, 1);
    detected = detectLang(first.blocks.map((b) => b.text).join(" "));
  } catch {
    /* scanned or empty first page */
  }
  return { pageCount, detected };
}

export interface CreateDocInput {
  name: string;
  size: number;
  data: ArrayBuffer;
  pageCount: number;
  selectedPages: number[] | null;
  sourceLang: LangCode;
  detectedLang?: LangCode;
  targetLang: LangCode;
  engine: EngineId;
}

export async function createDoc(input: CreateDocInput): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const doc: DocRecord = {
    id,
    name: input.name,
    size: input.size,
    createdAt: now,
    updatedAt: now,
    pageCount: input.pageCount,
    selectedPages: input.selectedPages,
    sourceLang: input.sourceLang,
    detectedLang: input.detectedLang,
    targetLang: input.targetLang,
    engine: input.engine,
    status: "ready",
    progress: 0,
    data: input.data,
  };
  await db.documents.put(doc);
  return id;
}
