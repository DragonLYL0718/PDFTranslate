import type { TextBlock } from "@/types";

export interface RawItem {
  str: string;
  x: number;
  y: number; // top
  w: number;
  h: number; // font height
}

interface Line {
  x: number;
  y: number;
  right: number;
  bottom: number;
  h: number;
  text: string;
}

/**
 * A horizontal gap wider than this (in font heights) means a column gutter or
 * table cell boundary rather than a word space.
 */
const COLUMN_GAP_RATIO = 1.5;

/**
 * Heuristic grouping of raw text items into paragraph-like blocks.
 * 1) cluster items into lines by vertical proximity, splitting each row at
 *    wide horizontal gaps so parallel columns stay separate, 2) merge lines
 * into blocks by left-alignment + line-gap + similar font size.
 */
export function groupIntoBlocks(items: RawItem[], pageNumber: number): TextBlock[] {
  if (items.length === 0) return [];

  // --- lines ---
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  let cur: RawItem[] = [];
  let curY = sorted[0].y;
  const yTol = () => Math.max(2, (cur[0]?.h ?? 10) * 0.6);

  const flush = () => {
    if (!cur.length) return;
    const parts = [...cur].sort((a, b) => a.x - b.x);

    // Split the row into runs separated by wide gaps. On a multi-column page
    // the left and right columns share the same y, so merging the whole row
    // would splice unrelated sentences into one line with a full-width bbox.
    let run: RawItem[] = [];
    let prevRight = parts[0].x;

    const flushRun = () => {
      if (!run.length) return;
      let text = "";
      let right = run[0].x;
      for (const p of run) {
        if (text && p.x - right > p.h * 0.25) text += " ";
        text += p.str;
        right = p.x + p.w;
      }
      const y = Math.min(...run.map((p) => p.y));
      const h = Math.max(...run.map((p) => p.h));
      lines.push({
        x: Math.min(...run.map((p) => p.x)),
        right: Math.max(...run.map((p) => p.x + p.w)),
        y,
        bottom: y + h,
        h,
        text: text.trim(),
      });
      run = [];
    };

    for (const p of parts) {
      if (run.length && p.x - prevRight > p.h * COLUMN_GAP_RATIO) flushRun();
      run.push(p);
      prevRight = Math.max(prevRight, p.x + p.w);
    }
    flushRun();
    cur = [];
  };

  for (const it of sorted) {
    if (cur.length && Math.abs(it.y - curY) > yTol()) {
      flush();
    }
    if (!cur.length) curY = it.y;
    cur.push(it);
  }
  flush();

  // --- blocks ---
  // Each line joins whichever open group sits directly above it and overlaps
  // it horizontally, so parallel columns accumulate independently instead of
  // being merged by scan order.
  const groups: Line[][] = [];
  for (const line of lines) {
    if (!line.text) continue;
    let target: Line[] | undefined;
    // Search most-recent-first: those are the groups still being extended.
    for (let i = groups.length - 1; i >= 0; i--) {
      const prev = groups[i][groups[i].length - 1];
      const gap = line.y - prev.bottom;
      if (gap >= prev.h * 0.9 || gap <= -prev.h) continue;
      if (Math.abs(line.x - prev.x) >= prev.h * 1.5) continue;
      if (Math.abs(line.h - prev.h) >= prev.h * 0.4) continue;
      // Must share horizontal space — otherwise it's a neighbouring column.
      if (Math.min(line.right, prev.right) - Math.max(line.x, prev.x) <= 0) continue;
      target = groups[i];
      break;
    }
    if (target) target.push(line);
    else groups.push([line]);
  }

  const blocks: TextBlock[] = groups.map((bl, i) => {
    const x = Math.min(...bl.map((l) => l.x));
    const right = Math.max(...bl.map((l) => l.right));
    const y = Math.min(...bl.map((l) => l.y));
    const bottom = Math.max(...bl.map((l) => l.bottom));
    return {
      id: `p${pageNumber}-b${i}`,
      bbox: { x, y, w: right - x, h: bottom - y },
      text: bl.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim(),
      fontSize: median(bl.map((l) => l.h)),
      dir: "ltr" as const,
    };
  });

  return blocks.filter((b) => b.text.length > 0);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
