/**
 * Formula/code/URL protection for translation.
 * Identifies patterns that should NOT be translated and replaces them with
 * ordinal placeholders (⟦0⟧, ⟦1⟧ …) before sending to the AI, then restores
 * them after translation.
 */

export interface Placeholder {
  idx: number;
  original: string;
}

// Regex patterns — order matters (most specific / longest first).
const PATTERNS: { re: RegExp; label: string }[] = [
  // LaTeX display math
  { re: /\$\$[\s\S]*?\$\$/g, label: "display-math" },
  // LaTeX inline math
  { re: /\$[^\s$][^$]*?\$/g, label: "inline-math" },
  { re: /\\\([\s\S]*?\\\)/g, label: "latex-paren" },
  { re: /\\\[[\s\S]*?\\\]/g, label: "latex-bracket" },
  // Fenced code blocks
  { re: /```[\s\S]*?```/g, label: "code-block" },
  // Inline code
  { re: /`[^`\n]+`/g, label: "inline-code" },
  // URLs
  { re: /https?:\/\/[^\s)」】、,。，；；]+/g, label: "url" },
  // Emails
  { re: /[\w.-]+@[\w.-]+\.\w{2,}/g, label: "email" },
  // File paths / absolute references
  { re: /(?:\/[a-zA-Z0-9._-]+)+(?:\/\*)?/g, label: "path" },
  // Numeric measurements (e.g. 12.5px, 3.14, 42%)
  { re: /\b\d+(?:\.\d+)?(?:\s*(?:px|pt|em|rem|%|cm|mm|in|ms|s|deg))?\b/g, label: "numeric" },
];

/**
 * Scan text for protected patterns and replace each with ⟦idx⟧.
 * Returns the cleaned text and an ordered map so restoration is deterministic.
 *
 * Substitution is done in a single left-to-right pass over the matched spans.
 * Replacing by searching for the matched *substring* would corrupt the text:
 * `String.replace` only hits the first occurrence, so protecting "5" in
 * "[13] ... [35]" would land inside "35" and yield "[⟦0⟧3]".
 */
export function applyProtection(text: string): { cleaned: string; map: Placeholder[] } {
  // Collect all matches
  const matches: { start: number; end: number; original: string }[] = [];
  for (const { re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      matches.push({ start: m.index!, end: m.index! + m[0].length, original: m[0] });
    }
  }

  // Sort by position, deduplicate overlapping (keep the first/longest)
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const filtered: typeof matches = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  const map: Placeholder[] = [];
  let cleaned = "";
  let pos = 0;
  for (const m of filtered) {
    const idx = map.length;
    map.push({ idx, original: m.original });
    cleaned += text.slice(pos, m.start) + `⟦${idx}⟧`;
    pos = m.end;
  }
  cleaned += text.slice(pos);

  return { cleaned, map };
}

/** Restore placeholders after translation (AI may have moved them around). */
export function restore(text: string, map: Placeholder[]): string {
  let result = text;
  for (const p of map) {
    // Replace every occurrence: models sometimes duplicate a placeholder.
    // ⟦1⟧ can't match inside ⟦10⟧ because the closing bracket is required.
    result = result.split(`⟦${p.idx}⟧`).join(p.original);
  }
  return result;
}
