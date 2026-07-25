import { db } from "@/db/db";
import type { Annotation, Bbox } from "@/types";

function uid(): string {
  return crypto.randomUUID();
}

export async function addAnnotation(
  docId: string,
  pageNumber: number,
  anchor: string,
  bbox: Bbox | null,
  comment: string,
  color = "var(--accent)",
): Promise<string> {
  const id = uid();
  const now = Date.now();
  await db.annotations.put({ id, docId, pageNumber, anchor, bbox, color, comment, createdAt: now });
  return id;
}

export async function updateAnnotation(id: string, patch: Partial<Annotation>): Promise<void> {
  await db.annotations.update(id, patch);
}

export async function deleteAnnotation(id: string): Promise<void> {
  await db.annotations.delete(id);
}

export async function listAnnotations(docId: string): Promise<Annotation[]> {
  return db.annotations.where("docId").equals(docId).sortBy("pageNumber");
}
