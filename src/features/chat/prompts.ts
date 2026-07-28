// Prompts for the reader's chat.
//
// The summary prompt is long-form instruction text, not UI copy, so it lives
// here rather than in the message catalogs: the locale generator batches 40 keys
// per request and validates length ratios, neither of which suits a 40-line
// prompt. zh and en are hand-written; any other interface language gets one
// generated on demand and cached in settings.

import { getLocale, t, type LocaleId } from "@/i18n";
import { findCustomLocale } from "@/i18n/customStore";
import { patchSettings, readSettings } from "@/db/db";
import { langPromptName } from "@/features/import/languages";
import { llmComplete } from "@/features/providers/translate";
import type { LangCode, Provider } from "@/types";

const EN_SUMMARY = `You are a meticulous research assistant helping a reader get through a paper quickly and critically. You are given passages sampled across the whole document, each tagged with its page number.

Write a structured summary in Markdown. Use exactly these sections, in this order, keeping the headings:

## In one sentence
One sentence on what kind of paper this is and what it does.

## Problem & motivation
What does not work today, and why it is worth fixing. Name the specific gap the authors claim, not the field's generic one.

## Core approach
The method or system in plain language first, then the one technical detail that actually makes it work. If it is a system, say what it builds on, what is new and what is borrowed.

## How it was evaluated
Study design, tasks, participants or datasets, baselines, and which measures are reported. For a user study give N, within- or between-subjects, and what was actually measured; for a benchmark give the datasets and the metrics. If this is not an empirical paper (a survey, a position piece, a proof), describe what the authors offer as support instead.

## Key results
The 3-5 findings that carry the paper's claims, each with its concrete number and page, e.g. "task completion time dropped 31% (p7)".

## Limitations & reading it critically
Threats the authors admit, plus the parts their evidence does not actually support. Be specific about which claim outruns which result.

Rules:
- Cite the page as (p12) whenever you state a number, a claim, or a definition.
- Use the paper's own wording for technical terms; do not invent synonyms. Keep the original term alongside a translation on first use.
- For any section the passages do not cover, write "not covered in the retrieved text" rather than guessing.
- No preamble and no closing pleasantries — start with the first heading.`;

const ZH_SUMMARY = `你是一位严谨的科研助手，帮助读者快速且带着批判地读完一篇论文。下面给出的是从全文采样的段落，每段都标注了页码。

请用 Markdown 写一份结构化摘要，严格使用下列小节与顺序，保留标题：

## 一句话结论
用一句话说清「这是一篇做什么的论文」。

## 问题与动机
现在到底哪里不行、为什么值得做。要写作者自己声称的那个具体缺口，而不是该领域通用的话。

## 核心方法
先用简单易懂的语言讲清楚方法或系统是什么，再补一个真正让它成立的技术细节。如果是系统，说明它建立在什么之上、哪些是新的、哪些是沿用的。

## 实验设计
研究设计、任务、被试或数据集、基线，以及汇报了哪些指标。用户研究要写清 N、被试内 / 被试间、实际测量了什么；跑 benchmark 的要写清数据集和指标。如果这不是一篇实证论文（综述、理论推导、观点文章），就改写作者用什么来支撑主张。

## 关键结果
支撑论文主张的 3-5 条发现，每条都带上具体数字和页码，例如「任务完成时间下降 31%（p7）」。

## 局限与批判性阅读
作者自己承认的威胁，加上「证据其实撑不起来」的部分。要具体指出哪一条结论超出了哪一个实验结果。

规则：
- 只要给出数字、结论或定义，就在句尾标注页码，格式为（p12）。
- 术语沿用论文自己的说法，不要另造同义词；首次出现时保留原文术语，例如「注意力机制（attention）」。
- 采样段落没有覆盖到的小节，写「检索到的内容未涵盖」，不要靠猜补齐。
- 不要开场白，不要结尾寒暄，直接从第一个标题开始。`;

const BUILT_IN: Record<string, string> = { en: EN_SUMMARY, zh: ZH_SUMMARY };

/** The interface language's own name, for telling the model what to answer in. */
export function localeLanguageName(locale: LocaleId = getLocale()): string {
  if (locale === "zh") return "Chinese";
  if (locale === "en") return "English";
  return findCustomLocale(locale)?.endonym ?? "the interface language";
}

export function builtInSummaryPrompt(locale: LocaleId): string | undefined {
  return BUILT_IN[locale];
}

export interface ResolvedPrompt {
  text: string;
  origin: "override" | "builtin" | "generated" | "fallback";
}

/**
 * The summary prompt for the current interface language: a user override wins,
 * then a built-in, then a cached generation. Generating is left to the caller
 * so a background resolve never fires an API call unasked.
 */
export async function resolveSummaryPrompt(locale: LocaleId = getLocale()): Promise<ResolvedPrompt> {
  const settings = await readSettings();
  const override = settings.chatSummaryPrompts[locale];
  if (override) {
    return { text: override, origin: BUILT_IN[locale] === override ? "builtin" : "override" };
  }
  const builtIn = BUILT_IN[locale];
  if (builtIn) return { text: builtIn, origin: "builtin" };
  return { text: EN_SUMMARY, origin: "fallback" };
}

/** True when this language has neither a built-in prompt nor a stored one. */
export async function needsGeneratedPrompt(locale: LocaleId = getLocale()): Promise<boolean> {
  if (BUILT_IN[locale]) return false;
  return !(await readSettings()).chatSummaryPrompts[locale];
}

export async function saveSummaryPrompt(locale: LocaleId, text: string): Promise<void> {
  const settings = await readSettings();
  await patchSettings({ chatSummaryPrompts: { ...settings.chatSummaryPrompts, [locale]: text } });
}

/** Drop the override so the built-in (or a fresh generation) takes over again. */
export async function resetSummaryPrompt(locale: LocaleId): Promise<void> {
  const settings = await readSettings();
  const { [locale]: _dropped, ...rest } = settings.chatSummaryPrompts;
  await patchSettings({ chatSummaryPrompts: rest });
}

/** A reply that lost the structure is worse than the English original. */
function acceptable(text: string): boolean {
  const headings = (text.match(/^##\s/gm) ?? []).length;
  return (
    text.length > EN_SUMMARY.length * 0.5 &&
    headings >= 5 &&
    /\(p\d+\)|（p\d+）/.test(text)
  );
}

/** Translate the English prompt into `locale`'s language and cache it. */
export async function generateSummaryPrompt(
  provider: Provider,
  locale: LocaleId,
  signal?: AbortSignal,
): Promise<string> {
  const language = localeLanguageName(locale);
  const system = [
    `You are localizing a prompt template into ${language}.`,
    "Rules:",
    "- Translate the prose and the section headings.",
    "- Keep the section order, the `##` heading structure and the rule list exactly as they are.",
    "- Keep the (p12) page-citation format literally; do not translate or reformat it.",
    "- Reply with ONLY the prompt text. No commentary, no code fences.",
  ].join("\n");
  const text = (await llmComplete(provider, system, EN_SUMMARY, signal)).trim();
  if (!acceptable(text)) throw new Error(t("chat.prompt.generateFailed"));
  await saveSummaryPrompt(locale, text);
  return text;
}

export interface DocFacts {
  name: string;
  pageCount: number;
  sourceLang: LangCode;
  targetLang: LangCode;
  translated: boolean;
}

/** Append the facts the prompt can't know, plus which language to answer in. */
export function withDocFacts(prompt: string, doc: DocFacts, locale: LocaleId = getLocale()): string {
  const translation = doc.translated
    ? `a ${langPromptName(doc.targetLang)} translation is available`
    : "it has not been translated";
  return [
    prompt,
    "",
    `Document: "${doc.name}" · ${doc.pageCount} pages · written in ${langPromptName(doc.sourceLang)}; ${translation}.`,
    `Write your answer in ${localeLanguageName(locale)}.`,
  ].join("\n");
}

/** System prompt for an ordinary question about the document. */
export function chatSystem(doc: DocFacts, locale: LocaleId = getLocale()): string {
  return [
    "You are a research assistant answering questions about one specific document.",
    "You are given passages retrieved from it, each tagged with its page number.",
    "Rules:",
    "- Answer from the passages. Cite the page as (p12) for every number, claim or definition.",
    "- If the passages don't answer the question, say so plainly and name what would be needed.",
    // Retrieval reruns per turn, so a follow-up rarely sees the exact passage the
    // previous answer quoted. Without this the model apologizes for its own
    // correct citation and refuses to elaborate.
    "- Passages are retrieved fresh for every question, so an earlier answer's passages may be absent now. Treat the conversation so far as established fact: build on your previous answers and never retract one merely because its passage is no longer shown.",
    "- Keep technical terms, model names, dataset names and metrics in their original form.",
    "- Be concise. Use Markdown when structure helps; skip it for a one-line answer.",
    "",
    `Document: "${doc.name}" · ${doc.pageCount} pages · written in ${langPromptName(doc.sourceLang)}.`,
    `Write your answer in ${localeLanguageName(locale)}.`,
  ].join("\n");
}

/** Asks for the follow-up chips shown under an answer. */
export function followupSystem(locale: LocaleId = getLocale()): string {
  return [
    "You suggest what a reader would naturally ask next about a document they are reading.",
    'Reply with JSON only, in the form {"q":["…","…","…"]} — three questions, at most four.',
    "Rules:",
    "- Each must be answerable from this document, not from general knowledge.",
    "- Follow on from what was just discussed; no generic 'tell me more'.",
    "- Ask about one concrete thing each: a number, a design decision, a comparison, a limitation.",
    "- Keep them short enough to read on a button.",
    `- Write them in ${localeLanguageName(locale)}.`,
  ].join("\n");
}
