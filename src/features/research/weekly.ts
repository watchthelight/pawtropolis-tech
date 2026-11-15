/**
 * Pawtropolis Tech -- src/features/research/weekly.ts
 * WHAT: Turns the scored messages of one week into the week's row of the
 *       overlay table: the means of the scores and seven measures of the
 *       week's text and of who wrote it.
 * WHY: The dashboard draws its long lines from one row per week, not from two
 *      million score rows. The measures continue the series that
 *      scripts/build-overlay-weekly.mjs began, so each one is computed the way
 *      that script did it. Two of them (the share of different words and the
 *      median length) need the texts themselves, which is why a week is built
 *      from the archive and not from the scores alone.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { StoredScore, WeekRow } from "./store.js";
import { weeklyFacts } from "./text.js";

/** One scored message with the text it was scored from. */
export interface WeekMessage {
  content: string;
  authorId: string;
  isReply: boolean;
  score: Pick<
    StoredScore,
    | "effort"
    | "heuristic"
    | "resonance"
    | "substantiveness"
    | "novelty"
    | "notFiller"
    | "lexicalDensity"
  >;
}

/** 0 when everyone wrote the same amount, close to 1 when one author wrote nearly all. */
function gini(values: number[]): number {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (n === 0 || sum === 0) return 0;
  let weighted = 0;
  sorted.forEach((value, i) => {
    weighted += (2 * (i + 1) - n - 1) * value;
  });
  return weighted / (n * sum);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) >> 1]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** The week's row, or null when the week has no scored message. */
export function summarizeWeek(
  weekStart: number,
  messages: WeekMessage[],
  lowlist: ReadonlySet<string>
): WeekRow | null {
  const count = messages.length;
  if (count === 0) return null;

  const sums = {
    effort: 0,
    heuristic: 0,
    resonance: 0,
    substantiveness: 0,
    novelty: 0,
    notFiller: 0,
    lexicalDensity: 0,
  };
  const lengths: number[] = [];
  const differentTokens = new Set<string>();
  let totalTokens = 0;
  let questions = 0;
  let repeatSpam = 0;
  let lowlistOnly = 0;
  let replies = 0;
  const perAuthor = new Map<string, number>();

  for (const message of messages) {
    sums.effort += message.score.effort;
    sums.heuristic += message.score.heuristic;
    sums.resonance += message.score.resonance;
    sums.substantiveness += message.score.substantiveness;
    sums.novelty += message.score.novelty;
    sums.notFiller += message.score.notFiller;
    sums.lexicalDensity += message.score.lexicalDensity;

    const facts = weeklyFacts(message.content, lowlist);
    lengths.push(facts.tokens.length);
    totalTokens += facts.tokens.length;
    for (const token of facts.tokens) differentTokens.add(token);
    if (facts.isQuestion) questions++;
    if (facts.isRepeatSpam) repeatSpam++;
    if (facts.isLowlistOnly) lowlistOnly++;
    if (message.isReply) replies++;
    perAuthor.set(message.authorId, (perAuthor.get(message.authorId) ?? 0) + 1);
  }

  return {
    weekStart,
    count,
    effort: sums.effort / count,
    heuristic: sums.heuristic / count,
    resonance: sums.resonance / count,
    medianLength: median(lengths),
    lexicalDiversity:
      totalTokens > 0 ? Math.log1p(differentTokens.size) / Math.log1p(totalTokens) : 0,
    questionRate: questions / count,
    noRepeatSpam: 1 - repeatSpam / count,
    noLowlistHit: 1 - lowlistOnly / count,
    replyRate: replies / count,
    authorDistribution: 1 - gini([...perAuthor.values()]),
    substantiveness: sums.substantiveness / count,
    novelty: sums.novelty / count,
    notFiller: sums.notFiller / count,
    lexDensity: sums.lexicalDensity / count,
  };
}
