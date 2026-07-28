import { db } from "@/db/db";
import type { ChatMessage, ChatSession } from "@/types";

let lastStamp = 0;

/**
 * Monotonic timestamp. Two turns written in the same millisecond would
 * otherwise sort arbitrarily, which reorders a question and its answer.
 */
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/** Most recently active first — the history list should open on what was being read. */
export async function listSessions(docId: string): Promise<ChatSession[]> {
  const rows = await db.chatSessions.where("docId").equals(docId).toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createSession(docId: string): Promise<ChatSession> {
  const now = stamp();
  const session: ChatSession = {
    id: crypto.randomUUID(),
    docId,
    title: "",
    createdAt: now,
    updatedAt: now,
  };
  await db.chatSessions.put(session);
  return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction("rw", [db.chatMessages, db.chatSessions], async () => {
    await db.chatMessages.where("sessionId").equals(sessionId).delete();
    await db.chatSessions.delete(sessionId);
  });
}

export function listMessages(sessionId: string): Promise<ChatMessage[]> {
  return db.chatMessages.where("sessionId").equals(sessionId).sortBy("createdAt");
}

export async function appendMessage(
  message: Omit<ChatMessage, "id" | "createdAt">,
): Promise<ChatMessage> {
  const row: ChatMessage = { ...message, id: crypto.randomUUID(), createdAt: stamp() };
  await db.chatMessages.put(row);
  // The first user turn names the conversation, so the history list reads as a
  // list of questions rather than a list of timestamps.
  const session = await db.chatSessions.get(message.sessionId);
  if (session) {
    const title =
      session.title || (message.role === "user" ? message.content.slice(0, 60) : session.title);
    await db.chatSessions.update(session.id, { title, updatedAt: row.createdAt });
  }
  return row;
}

export async function updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
  await db.chatMessages.update(id, patch);
}

export async function deleteMessage(id: string): Promise<void> {
  await db.chatMessages.delete(id);
}

/** Remember that the summary was generated or deliberately skipped. */
export async function setSummaryState(docId: string, state: "done" | "skipped"): Promise<void> {
  await db.documents.update(docId, { chatSummary: state });
}
