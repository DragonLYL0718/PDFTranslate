import { franc } from "franc-min";
import type { LangCode } from "@/types";

// UI language list (ISO 639-1 + Chinese label).
export const LANGUAGES: { code: LangCode; name: string }[] = [
  { code: "zh", name: "中文" },
  { code: "en", name: "英语" },
  { code: "ja", name: "日语" },
  { code: "ko", name: "韩语" },
  { code: "fr", name: "法语" },
  { code: "de", name: "德语" },
  { code: "es", name: "西班牙语" },
  { code: "it", name: "意大利语" },
  { code: "pt", name: "葡萄牙语" },
  { code: "ru", name: "俄语" },
  { code: "ar", name: "阿拉伯语" },
  { code: "hi", name: "印地语" },
  { code: "th", name: "泰语" },
  { code: "vi", name: "越南语" },
  { code: "id", name: "印尼语" },
  { code: "nl", name: "荷兰语" },
  { code: "pl", name: "波兰语" },
  { code: "tr", name: "土耳其语" },
  { code: "uk", name: "乌克兰语" },
];

const NAME_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l.name]));

export function langName(code: LangCode): string {
  if (code === "auto") return "自动识别";
  return NAME_BY_CODE.get(code) ?? code;
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
