/**
 * Pawtropolis Tech -- src/features/research/text.ts
 * WHAT: The text measures of the chat research: the 24 hand features of the
 *       effort model, the rule-based score, the text parts of substantiveness
 *       and the per-message facts behind the weekly table.
 * WHY: The effort model in models/effort_v1.json was trained on exactly these
 *      features, and the other measures continue a series that began in April
 *      2026. Each formula therefore mirrors the script it comes from
 *      (scripts/score-effort-v1.mjs, score-quality.mjs, score-substantiveness.mjs,
 *      build-overlay-weekly.mjs), odd corners included. A change here changes
 *      what a stored score means, so tests/features/research/text.test.ts pins
 *      the outputs.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { readFileSync } from "node:fs";

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
// The same two patterns without the g flag, for yes/no questions. A global
// pattern remembers where its last match ended, which would make the answer
// depend on the message that was looked at before.
const HAS_URL = /https?:\/\/\S+/;
const HAS_MENTION = /<@!?\d+>|<#\d+>|<@&\d+>/;

/** What the measures need to know about one message. */
export interface MessageFacts {
  content: string;
  hasAttachment: boolean;
  hasEmbed: boolean;
  isReply: boolean;
  /** The text of the messages before it, oldest first. At most three. */
  context: string[];
}

/** Lowercased words with links, mentions and emoji taken out. */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(URL_RE, " ")
    .replace(MENTION_RE, " ")
    .replace(EMOJI_RE, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function shannon(counts: number[]): number {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (!total) return 0;
  let h = 0;
  for (const c of counts) {
    if (!c) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** The longest run of one repeated character, spaces not counted. */
export function maxCharRun(s: string): number {
  let max = 1;
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === s.charAt(i - 1) && /\S/.test(ch)) {
      run++;
      if (run > max) max = run;
    } else run = 1;
  }
  return max;
}

function maxWordRun(toks: string[]): number {
  let max = 1;
  let run = 1;
  for (let i = 1; i < toks.length; i++) {
    if (toks[i] === toks[i - 1]) {
      run++;
      if (run > max) max = run;
    } else run = 1;
  }
  return max;
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/**
 * The hand features of the effort model, in the order of `hand_features` in the
 * model file: char_len_log, word_count_log, uniq_word_ratio, avg_word_len,
 * alpha_ratio, digit_ratio, nonascii_ratio, punct_ratio, caps_ratio,
 * max_char_run_norm, max_word_run_norm, has_url, has_mention, has_question,
 * has_attachment, has_embed, is_reply, lowlist_ratio, all_lowlist, word_entropy,
 * char_entropy, ctx_msg_count, ctx_jaccard, ctx_total_chars_log.
 */
export function handFeatures(m: MessageFacts, lowlist: ReadonlySet<string>): number[] {
  const content = m.content;
  const toks = tokens(content);
  const wordCount = toks.length;
  const charCount = content.length;

  let letters = 0;
  let digits = 0;
  let punct = 0;
  let nonAscii = 0;
  let caps = 0;
  for (const ch of content) {
    if (/[a-zA-Z]/.test(ch)) {
      letters++;
      if (ch >= "A" && ch <= "Z") caps++;
    } else if (/[0-9]/.test(ch)) digits++;
    else if (/[^\s]/.test(ch)) {
      if (ch.charCodeAt(0) > 127) nonAscii++;
      else punct++;
    }
  }
  const visible = letters + digits + punct + nonAscii;

  const wordFreq = new Map<string, number>();
  for (const t of toks) wordFreq.set(t, (wordFreq.get(t) ?? 0) + 1);
  const charFreq = new Map<string, number>();
  for (const ch of content) charFreq.set(ch, (charFreq.get(ch) ?? 0) + 1);

  const contextTokens = m.context.flatMap((text) => tokens(text));
  const contextChars = m.context.reduce((sum, text) => sum + text.length, 0);
  const lowHits = toks.filter((t) => lowlist.has(t)).length;

  return [
    Math.log1p(charCount),
    Math.log1p(wordCount),
    wordCount ? wordFreq.size / wordCount : 0,
    wordCount ? charCount / wordCount : 0,
    visible ? letters / visible : 0,
    visible ? digits / visible : 0,
    visible ? nonAscii / visible : 0,
    visible ? punct / visible : 0,
    letters ? caps / letters : 0,
    Math.min(1, maxCharRun(content) / 10),
    Math.min(1, maxWordRun(toks) / 10),
    HAS_URL.test(content) ? 1 : 0,
    HAS_MENTION.test(content) ? 1 : 0,
    content.includes("?") ? 1 : 0,
    m.hasAttachment ? 1 : 0,
    m.hasEmbed ? 1 : 0,
    m.isReply ? 1 : 0,
    wordCount ? lowHits / wordCount : 0,
    wordCount > 0 && wordCount <= 3 && lowHits === wordCount ? 1 : 0,
    shannon([...wordFreq.values()]),
    shannon([...charFreq.values()]),
    m.context.length,
    jaccard(toks, contextTokens),
    Math.log1p(contextChars),
  ];
}

/** What the embedding model gets for the context: the texts in one line. */
export function contextText(context: string[]): string {
  return context.filter(Boolean).join(" ") || " ";
}

// ---- rule-based score (scripts/score-quality.mjs) ----

function heuristicTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function maxLetterRun(s: string): number {
  let max = 1;
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === s.charAt(i - 1) && /[a-zA-Z]/.test(ch)) {
      run++;
      if (run > max) max = run;
    } else run = 1;
  }
  return max;
}

/**
 * Length, variety and share of letters count for a message; stretched letters
 * and a message made of nothing but throwaway words count against it.
 */
export function heuristicScore(
  content: string,
  hasAttachment: boolean,
  hasEmbed: boolean,
  lowlist: ReadonlySet<string>
): number {
  const trimmed = content.trim();
  if (!trimmed) return hasAttachment || hasEmbed ? 0.5 : 0;

  const toks = heuristicTokens(trimmed);
  const words = toks.length;
  let letters = 0;
  let nonAlpha = 0;
  for (const ch of trimmed) {
    if (/[a-zA-Z]/.test(ch)) letters++;
    else if (!/\s/.test(ch)) nonAlpha++;
  }
  const repeatRun = maxLetterRun(trimmed);

  const length = Math.min(1, Math.log1p(words) / Math.log1p(40));
  const variety = words ? new Set(toks).size / words : 0;
  const alpha = letters + nonAlpha > 0 ? letters / (letters + nonAlpha) : 0;
  const repeat = repeatRun >= 4 ? Math.min(1, (repeatRun - 3) / 5) : 0;
  const allLow = words > 0 && words <= 3 && toks.every((t) => lowlist.has(t));

  // The 0.10 puts an ordinary ten-word message at about 0.55.
  const score =
    0.3 * length + 0.2 * variety + 0.1 * alpha - 0.2 * repeat - 0.4 * (allLow ? 1 : 0) + 0.1;
  return Math.max(0, Math.min(1, score));
}

// ---- substantiveness (scripts/score-substantiveness.mjs) ----

// English stopwords, a short list on purpose.
// prettier-ignore
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "i", "me", "my", "you", "your", "he", "she", "it", "its", "we", "our", "they", "them", "their",
  "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "as", "so", "no", "not", "yes", "yeah",
  "will", "would", "can", "could", "should", "may", "might", "just", "also", "too",
  "one", "two", "some", "any", "all", "each", "every", "more", "most", "other", "only",
]);
const TRAILING_PUNCT = /[!?.,;:~\-_*]+$/;

function stripMarkup(s: string): string {
  return s.toLowerCase().replace(URL_RE, " ").replace(MENTION_RE, " ").replace(EMOJI_RE, " ");
}

/** True when the whole message is one of the stock phrases in the filler bank. */
export function isFiller(content: string, fillerBank: ReadonlySet<string>): boolean {
  const normalized = stripMarkup(content).replace(/\s+/g, " ").trim().replace(TRAILING_PUNCT, "");
  return normalized !== "" && fillerBank.has(normalized);
}

/** Different content words divided by all content words. 0 without any. */
export function lexicalDensity(content: string): number {
  const toks = stripMarkup(content)
    .split(/[\s.,!?;:()[\]'"~`]+/)
    .filter((t) => t && !STOPWORDS.has(t));
  return toks.length > 0 ? new Set(toks).size / toks.length : 0;
}

/** 1 minus the cosine between the message's vector and its context's vector, kept in 0..1. */
export function novelty(target: Float32Array, context: Float32Array): number {
  let dot = 0;
  let normT = 0;
  let normC = 0;
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!;
    const c = context[i]!;
    dot += t * c;
    normT += t * t;
    normC += c * c;
  }
  const cosine = dot / (Math.sqrt(normT) * Math.sqrt(normC) + 1e-9);
  return Math.max(0, Math.min(1, 1 - cosine));
}

export function substantiveness(nov: number, notFiller: number, density: number): number {
  return 0.5 * nov + 0.3 * notFiller + 0.2 * density;
}

// ---- per-message facts of the weekly table (scripts/build-overlay-weekly.mjs) ----

export interface WeeklyFacts {
  tokens: string[];
  isQuestion: boolean;
  isRepeatSpam: boolean;
  isLowlistOnly: boolean;
}

export function weeklyFacts(content: string, lowlist: ReadonlySet<string>): WeeklyFacts {
  const toks = tokens(content);
  return {
    tokens: toks,
    isQuestion: content.includes("?"),
    isRepeatSpam: maxCharRun(content) >= 4,
    isLowlistOnly: toks.length > 0 && toks.length <= 3 && toks.every((t) => lowlist.has(t)),
  };
}

// ---- word lists ----

/** Reads `key` (an array of strings) from a JSON file, lowercased. */
export function loadWordList(file: string, key: "tokens" | "phrases"): Set<string> {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const list = parsed[key];
  if (!Array.isArray(list)) throw new Error(`${file} has no "${key}" list`);
  return new Set(list.map((entry) => String(entry).toLowerCase()));
}
