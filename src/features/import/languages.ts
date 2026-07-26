import { franc } from "franc-min";
import { t, type PlainKey } from "@/i18n";
import type { LangCode } from "@/types";

// Supported document languages. `en` is the canonical name handed to the model;
// the name shown in the UI comes from the catalog (`lang.<code>`) instead, so
// the interface language can't leak into a prompt.
export const LANGUAGES: { code: LangCode; en: string }[] = [
  { code: "zh", en: "Chinese" },
  { code: "en", en: "English" },
  { code: "ja", en: "Japanese" },
  { code: "ko", en: "Korean" },
  { code: "fr", en: "French" },
  { code: "de", en: "German" },
  { code: "es", en: "Spanish" },
  { code: "it", en: "Italian" },
  { code: "pt", en: "Portuguese" },
  { code: "ru", en: "Russian" },
  { code: "ar", en: "Arabic" },
  { code: "hi", en: "Hindi" },
  { code: "th", en: "Thai" },
  { code: "vi", en: "Vietnamese" },
  { code: "id", en: "Indonesian" },
  { code: "nl", en: "Dutch" },
  { code: "pl", en: "Polish" },
  { code: "tr", en: "Turkish" },
  { code: "uk", en: "Ukrainian" },
];

const EN_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l.en]));

/** For LLM prompts — always English, never localized. */
export function langPromptName(code: LangCode): string {
  if (code === "auto") return "the source language (auto-detect)";
  return EN_BY_CODE.get(code) ?? code;
}

/** For display — follows the interface language. */
export function langName(code: LangCode): string {
  if (code !== "auto" && !EN_BY_CODE.has(code)) return code;
  return t(`lang.${code}` as PlainKey);
}

// franc returns ISO 639-3; map the ones we support back to 639-1.
const ISO3_TO_1: Record<string, LangCode> = {
  eng: "en", cmn: "zh", jpn: "ja", kor: "ko", fra: "fr", deu: "de",
  spa: "es", ita: "it", por: "pt", rus: "ru", arb: "ar", ara: "ar",
  hin: "hi", tha: "th", vie: "vi", ind: "id", nld: "nl", pol: "pl",
  tur: "tr", ukr: "uk",
};

/** Detect the language of a text sample. Returns "auto" if undetermined. */
export function detectLang(text: string): LangCode {
  const sample = text.slice(0, 4000);
  if (sample.trim().length < 12) return "auto";
  const iso3 = franc(sample);
  return ISO3_TO_1[iso3] ?? "auto";
}
