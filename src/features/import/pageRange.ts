/**
 * Normalize full-width digits/comma/dash (common with CJK IMEs, which often
 * default to full-width punctuation while typing Chinese) to their ASCII
 * equivalents so "１，３，５－８" parses the same as "1,3,5-8".
 */
function normalizeDigits(spec: string): string {
  return spec
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ",")
    .replace(/[－—～]/g, "-");
}

/**
 * Parse a page-range spec like "1,5,8-12" into a sorted, de-duplicated,
 * 1-based page-number list clamped to [1, pageCount].
 * - Blank or "all" -> null (means "all pages").
 * - Non-blank but unparseable / out-of-range -> [] (invalid, NOT "all") so
 *   callers can tell a typo apart from an intentional blank field.
 */
export function parsePageRange(spec: string, pageCount: number): number[] | null {
  const trimmed = normalizeDigits(spec.trim());
  if (!trimmed || trimmed.toLowerCase() === "all") return null;
  const set = new Set<number>();
  for (const part of trimmed.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= pageCount) set.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 1 && n <= pageCount) set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Compact a page list back into a spec ("1,3,5-8"). Empty list -> "" (all pages). */
export function formatPageRange(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    parts.push(end > i ? `${sorted[i]}-${sorted[end]}` : `${sorted[i]}`);
    i = end + 1;
  }
  return parts.join(",");
}

export function pagesToTranslate(selected: number[] | null, pageCount: number): number[] {
  if (!selected) return Array.from({ length: pageCount }, (_, i) => i + 1);
  return selected;
}
