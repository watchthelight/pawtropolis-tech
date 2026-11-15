/**
 * Pawtropolis Tech -- web/src/lib/shared/quality-types.ts
 * WHAT: The shapes the Quality page gets from its queries, and the list of
 *       weekly measures with their labels.
 * WHY: The page's components run in the browser too, so these cannot live
 *      in $lib/server, which SvelteKit keeps out of client code.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/** The scores of one time window. */
export interface QualityOverview {
  totalScored: number;
  meanEffort: number;
  meanResonance: number;
  meanSubstantiveness: number;
  /** Share of the messages with an effort score under 0.2. */
  lowEffortShare: number;
}

export interface QualityWeekBucket {
  weekStart: number;
  iso: string;
  count: number;
  meanEffort: number;
  /** Mean effort over this week and the three before it, weighted by message count. */
  rolling4w: number;
  lowEffortShare: number;
}

export interface EffortBin {
  binStart: number;
  binEnd: number;
  count: number;
}

export interface WindowSummary {
  overview: QualityOverview;
  weeks: QualityWeekBucket[];
  bins: EffortBin[];
}

export interface AuthorRow {
  id: string;
  display: string;
  /** False once the member has left the server. */
  inGuild: boolean;
  msgs: number;
  meanEffort: number;
  /** Mean effort times log10 of the message count. */
  composite: number;
  /** One minus mean effort, times log10 of the message count. */
  drag: number;
}

export interface AuthorBoards {
  distinctAuthors: number;
  minMsgs: number;
  topEffort: AuthorRow[];
  workhorses: AuthorRow[];
  drains: AuthorRow[];
}

/**
 * The weekly measures of the job besides effort, which has a chart of its
 * own. `column` is the column of weekly_overlay in the score file. A share is
 * shown as a percentage, a number as it is.
 */
export const WEEKLY_MEASURES = [
  {
    key: "substantiveness",
    column: "substantiveness",
    label: "Substantiveness",
    unit: "share",
    hint: "Half novelty against the messages before, the rest for not being a stock phrase and for varied words.",
  },
  {
    key: "resonance",
    column: "resonance",
    label: "Resonance",
    unit: "share",
    hint: "Replies a message drew, on a logarithmic scale. The 95th percentile of all messages counts as 100%.",
  },
  {
    key: "replyRate",
    column: "reply_rate",
    label: "Reply rate",
    unit: "share",
    hint: "Messages that answer another message.",
  },
  {
    key: "questionRate",
    column: "question_rate",
    label: "Question rate",
    unit: "share",
    hint: "Messages with a question mark in them.",
  },
  {
    key: "medianLength",
    column: "median_length",
    label: "Median length",
    unit: "words",
    hint: "The length of the middle message of the week, in words.",
  },
  {
    key: "lexicalDiversity",
    column: "lexical_diversity",
    label: "Word variety",
    unit: "share",
    hint: "Different words against all words of the week, on a logarithmic scale.",
  },
  {
    key: "authorDistribution",
    column: "author_distribution",
    label: "Spread over authors",
    unit: "share",
    hint: "100% when everyone writes the same amount, lower when a few people write most of it.",
  },
  {
    key: "heuristic",
    column: "heuristic",
    label: "Rule-based score",
    unit: "share",
    hint: "The older score from fixed rules: length, variety and filler words.",
  },
  {
    key: "noLowlistHit",
    column: "no_lowlist_hit",
    label: "More than a throwaway",
    unit: "share",
    hint: "Messages with more in them than one to three words from the throwaway list, such as a lone lol.",
  },
  {
    key: "noRepeatSpam",
    column: "no_repeat_spam",
    label: "No repeat spam",
    unit: "share",
    hint: "Messages without a character repeated four times or more in a row.",
  },
] as const;

export type WeeklyMeasure = (typeof WEEKLY_MEASURES)[number];
export type WeeklyMeasureKey = WeeklyMeasure["key"];

export interface MeasureWeek {
  weekStart: number;
  iso: string;
  count: number;
  values: Record<WeeklyMeasureKey, number>;
}

/** The last twelve weeks, and the last four of them against the four before. */
export interface QualityTrend {
  weeks: { weekStart: number; effort: number; substantiveness: number }[];
  effort: { current: number; prior: number; deltaPct: number };
  substantiveness: { current: number; prior: number; deltaPct: number };
  sentence: string;
}

/** Means over everything the job has scored. */
export interface AllTimeMeans {
  effort: number;
  resonance: number;
  substantiveness: number;
}

/** What the job last wrote about itself. */
export interface ScoreStatus {
  total: number;
  /** Messages that still wait for a score. */
  pending: number;
  oldestS: number | null;
  newestS: number | null;
  lastRunS: number | null;
}
