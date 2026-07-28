// Tokenizer for the local search index. Has to handle a Chinese question against
// an English paper, so it produces comparable tokens for both scripts without
// pulling in a segmenter dependency.

/** Common words that appear in nearly every chunk. IDF would flatten them anyway;
 *  dropping them just keeps the persisted index smaller. */
const STOP = new Set(
  ("a an the and or but if then than that this these those of in on at to for from by with " +
    "as is are was were be been being do does did have has had will would can could should " +
    "may might must not no it its we our you your they their he she his her i me my " +
    "such very more most other some any each which who whom what when where how why " +
    "也 的 了 是 在 和 与 或 及 等 对 从 到 把 被 就 都 而 我们 这 那 一个 可以 进行 通过").split(/\s+/),
);

function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // kana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xac00 && cp <= 0xd7af) || // hangul
    (cp >= 0xf900 && cp <= 0xfaff) // compat ideographs
  );
}

/** Scripts where one character is roughly one token, for cost estimates. */
export function isCjkChar(ch: string): boolean {
  return isCjk(ch.codePointAt(0)!);
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Strip a plural/tense suffix so "models" and "model" match. Not a real stemmer. */
function fold(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function pushWord(out: string[], word: string): void {
  if (word.length < 2 || STOP.has(word)) return;
  out.push(word);
  // Index both forms; the query side folds identically, so either one matches.
  const stem = fold(word);
  if (stem !== word) out.push(stem);
}

/**
 * CJK has no spaces, so bigrams stand in for words — 「注意力机制」 indexes as
 * 注意/意力/力机/机制. Single-character runs are kept whole since there is no
 * bigram to form.
 */
function pushCjk(out: string[], run: string): void {
  const chars = [...run];
  if (chars.length === 1) {
    if (!STOP.has(chars[0])) out.push(chars[0]);
    return;
  }
  for (let i = 0; i + 1 < chars.length; i++) {
    const bigram = chars[i] + chars[i + 1];
    if (!STOP.has(bigram)) out.push(bigram);
  }
}

export function tokenize(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const out: string[] = [];
  let word = "";
  let cjk = "";

  const flushWord = () => {
    if (word) pushWord(out, word);
    word = "";
  };
  const flushCjk = () => {
    if (cjk) pushCjk(out, cjk);
    cjk = "";
  };

  for (const ch of normalized) {
    if (isCjk(ch.codePointAt(0)!)) {
      flushWord();
      cjk += ch;
    } else if (WORD_CHAR.test(ch)) {
      flushCjk();
      word += ch;
    } else {
      flushWord();
      flushCjk();
    }
  }
  flushWord();
  flushCjk();
  return out;
}
