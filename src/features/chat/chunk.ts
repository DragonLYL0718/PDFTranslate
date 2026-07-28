import type { RagChunk } from "@/types";
import type { PageText } from "./corpus";

const TARGET_CHARS = 900;
const MAX_CHARS = 1400;
const MIN_CHARS = 40;

/**
 * Split one over-long unit on sentence boundaries. Only reached when a single
 * block is itself larger than a chunk — normally blocks are paragraphs and
 * chunks break between them, which is why there is no sliding overlap here:
 * paragraph boundaries are already meaningful, so nothing is cut mid-thought.
 */
function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const out: string[] = [];
  let buf = "";
  for (const sentence of text.split(/(?<=[.!?。！？])\s+/)) {
    if (sentence.length > MAX_CHARS) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < sentence.length; i += MAX_CHARS) {
        out.push(sentence.slice(i, i + MAX_CHARS));
      }
      continue;
    }
    if (buf && buf.length + sentence.length > MAX_CHARS) {
      out.push(buf);
      buf = "";
    }
    buf = buf ? `${buf} ${sentence}` : sentence;
  }
  if (buf) out.push(buf);
  return out;
}

/** Group a document's text into retrievable passages. Chunks never span pages,
 *  so the page number on a citation is always exact. */
export function chunkPages(docId: string, pages: PageText[]): RagChunk[] {
  const chunks: RagChunk[] = [];

  for (const page of pages) {
    let ordinal = 0;
    let source: string[] = [];
    let translated: string[] = [];
    let blockIds: string[] = [];
    let size = 0;

    const flush = () => {
      const text = source.join("\n").trim();
      source = [];
      const target = translated.join("\n").trim();
      translated = [];
      const ids = blockIds;
      blockIds = [];
      size = 0;
      // Page numbers and running heads land here; they're noise, not passages.
      if (text.length < MIN_CHARS) return;
      chunks.push({
        id: `${docId}:${page.pageNumber}:${ordinal++}`,
        pageNumber: page.pageNumber,
        text,
        translated: target || undefined,
        blockIds: ids.length ? ids : undefined,
        len: 0, // filled in when the index is built
      });
    };

    for (const unit of page.units) {
      for (const [i, piece] of splitLong(unit.text).entries()) {
        if (size > 0 && size + piece.length > TARGET_CHARS) flush();
        source.push(piece);
        // The translation and the block id ride along with the unit's first
        // piece: a split block is still one block on the page.
        if (i === 0 && unit.translated) translated.push(unit.translated);
        if (i === 0 && unit.blockId) blockIds.push(unit.blockId);
        size += piece.length;
      }
    }
    flush();
  }

  return chunks;
}
