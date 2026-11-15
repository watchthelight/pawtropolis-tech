/**
 * Pawtropolis Tech -- web/src/lib/server/queries/quality.ts
 * WHAT: The numbers of the Quality page, read from the score file of the
 *       research job.
 * WHY: The page is the only reader of that file. Every function gives an
 *      empty answer as long as the file is missing, so the page can say so.
 *
 *      A window over the whole history covers about two million scores, and
 *      these queries run on the dashboard's one thread. So the window is read
 *      in two passes and not in one per chart: one grouped by week and effort
 *      bin, which gives the means, the low-effort share, the weekly series
 *      and the histogram, and one grouped by author. The weekly measures come
 *      from the small table the job keeps.
 *
 *      Means, histogram and boards count the scores inside the window. Every
 *      weekly series counts whole weeks: a week the window cuts in two is
 *      given in full.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "$lib/server/db";
import { researchDb } from "$lib/server/researchDb";
import type { ResolvedRange } from "$lib/shared/timeWindow";
import {
  WEEKLY_MEASURES,
  type AllTimeMeans,
  type AuthorBoards,
  type AuthorRow,
  type EffortBin,
  type MeasureWeek,
  type QualityTrend,
  type QualityWeekBucket,
  type ScoreStatus,
  type WeeklyMeasure,
  type WeeklyMeasureKey,
  type WindowSummary,
} from "$lib/shared/quality-types";

// The week of the job: it starts on Monday 00:00 UTC (src/features/research/store.ts).
const WEEK_S = 7 * 86400;
const EPOCH_TO_MONDAY_S = 4 * 86400;
const WEEK_OF_ROW = `((created_at_s - ${EPOCH_TO_MONDAY_S}) / ${WEEK_S}) * ${WEEK_S} + ${EPOCH_TO_MONDAY_S}`;

const BIN_COUNT = 20;
/** The bins under an effort score of 0.2, which is the cutoff for low effort. */
const LOW_EFFORT_BINS = 4;
const ROLLING_WEEKS = 4;
const BOARD_SIZE = 10;
const TREND_WEEKS = 12;
const TREND_BLOCK = 4;
/** A change under this many percent is called "about the same". */
const TREND_NOISE_PCT = 2;

const isoDay = (timeS: number): string => new Date(timeS * 1000).toISOString().slice(0, 10);
const weekStartOf = (timeS: number): number =>
  Math.floor((timeS - EPOCH_TO_MONDAY_S) / WEEK_S) * WEEK_S + EPOCH_TO_MONDAY_S;

/**
 * Means and histogram of one window and the effort of the weeks it touches,
 * from a single pass over the scores.
 *
 * The pass starts three weeks before the first week of the window, so that
 * the mean over four weeks is one over four weeks from the first point on.
 * Those three weeks are in no other number.
 */
export function getWindowSummary(range: ResolvedRange): WindowSummary {
  const bins: EffortBin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    binStart: i / BIN_COUNT,
    binEnd: (i + 1) / BIN_COUNT,
    count: 0,
  }));
  const firstWeekS = weekStartOf(range.startS);
  const rows = (researchDb()
    ?.prepare(
      `SELECT ${WEEK_OF_ROW} AS weekStart,
              created_at_s >= @startS AND created_at_s < @endS AS inWindow,
              MIN(CAST(effort * ${BIN_COUNT} AS INTEGER), ${BIN_COUNT - 1}) AS bin,
              COUNT(*) AS n,
              SUM(effort) AS effort,
              SUM(resonance) AS resonance,
              SUM(substantiveness) AS substantiveness
       FROM message_scores
       WHERE created_at_s >= @fromS AND created_at_s < @toS
       GROUP BY weekStart, inWindow, bin
       ORDER BY weekStart`
    )
    .all({
      startS: range.startS,
      endS: range.endS,
      fromS: firstWeekS - (ROLLING_WEEKS - 1) * WEEK_S,
      toS: weekStartOf(range.endS - 1) + WEEK_S,
    }) ?? []) as {
    weekStart: number;
    inWindow: number;
    bin: number;
    n: number;
    effort: number;
    resonance: number;
    substantiveness: number;
  }[];

  const total = { n: 0, effort: 0, resonance: 0, substantiveness: 0, low: 0 };
  const perWeek = new Map<number, { n: number; effort: number; low: number }>();
  for (const row of rows) {
    const low = row.bin < LOW_EFFORT_BINS ? row.n : 0;
    if (row.inWindow) {
      total.n += row.n;
      total.effort += row.effort;
      total.resonance += row.resonance;
      total.substantiveness += row.substantiveness;
      total.low += low;
      const bin = bins[row.bin];
      if (bin) bin.count += row.n;
    }
    const week = perWeek.get(row.weekStart) ?? { n: 0, effort: 0, low: 0 };
    week.n += row.n;
    week.effort += row.effort;
    week.low += low;
    perWeek.set(row.weekStart, week);
  }

  // Four weeks by the calendar: a week without messages is not made up for by an older one.
  const scored = [...perWeek].map(([weekStart, week]) => ({ weekStart, ...week }));
  const weeks: QualityWeekBucket[] = scored
    .filter((week) => week.weekStart >= firstWeekS)
    .map((week) => {
      const recent = scored.filter(
        (other) =>
          other.weekStart <= week.weekStart &&
          other.weekStart > week.weekStart - ROLLING_WEEKS * WEEK_S
      );
      const n = recent.reduce((sum, other) => sum + other.n, 0);
      const effort = recent.reduce((sum, other) => sum + other.effort, 0);
      return {
        weekStart: week.weekStart,
        iso: isoDay(week.weekStart),
        count: week.n,
        meanEffort: week.effort / week.n,
        rolling4w: effort / n,
        lowEffortShare: week.low / week.n,
      };
    });

  const mean = (sum: number): number => (total.n > 0 ? sum / total.n : 0);
  return {
    overview: {
      totalScored: total.n,
      meanEffort: mean(total.effort),
      meanResonance: mean(total.resonance),
      meanSubstantiveness: mean(total.substantiveness),
      lowEffortShare: mean(total.low),
    },
    weeks,
    bins,
  };
}

interface RankedAuthor {
  id: string;
  lastMessageId: string;
  msgs: number;
  meanEffort: number;
  composite: number;
  drag: number;
}

/**
 * Names for the authors on the boards. The member cache knows the people who
 * are or were in the server while the bot ran. For anyone else the archive
 * has the name the author's newest message carried.
 */
function describeAuthors(
  guildId: string,
  authors: RankedAuthor[]
): Map<string, { display: string; inGuild: boolean }> {
  const people = new Map<string, { display: string; inGuild: boolean }>();
  const newest = new Map(authors.map((author) => [author.id, author.lastMessageId]));
  if (newest.size === 0) return people;

  const ids = [...newest.keys()];
  const marks = ids.map(() => "?").join(", ");
  const bot = db();
  const cached = new Map(
    (
      bot
        .prepare(
          `SELECT user_id AS id, COALESCE(display_name, global_name, username) AS display
           FROM user_cache
           WHERE guild_id = ? AND user_id IN (${marks})`
        )
        .all(guildId, ...ids) as { id: string; display: string }[]
    ).map((row) => [row.id, row.display])
  );
  const gone = new Set(
    (
      bot
        .prepare(
          `SELECT user_id AS id
           FROM user_activity
           WHERE guild_id = ? AND left_at IS NOT NULL AND user_id IN (${marks})`
        )
        .all(guildId, ...ids) as { id: string }[]
    ).map((row) => row.id)
  );
  const archived = bot.prepare(
    "SELECT author_name AS display FROM messages_archive WHERE message_id = ?"
  );

  for (const [id, lastMessageId] of newest) {
    const display =
      cached.get(id) ??
      (archived.get(lastMessageId) as { display: string } | undefined)?.display ??
      `User ${id.slice(-6)}`;
    people.set(id, { display, inGuild: !gone.has(id) });
  }
  return people;
}

/** The three boards of authors with at least `minMsgs` scored messages in the window. */
export function getAuthorBoards(
  guildId: string,
  range: ResolvedRange,
  minMsgs = 200
): AuthorBoards {
  const scores = researchDb();
  if (!scores) return { distinctAuthors: 0, minMsgs, topEffort: [], workhorses: [], drains: [] };

  // With a single MAX() SQLite takes a bare column from the row that holds the maximum,
  // so lastMessageId is the author's newest message in the window.
  const authors = scores
    .prepare(
      `SELECT author_id AS id, COUNT(*) AS msgs, AVG(effort) AS meanEffort,
              MAX(created_at_s) AS lastS, message_id AS lastMessageId
       FROM message_scores
       WHERE created_at_s >= ? AND created_at_s < ?
       GROUP BY author_id`
    )
    .all(range.startS, range.endS) as {
    id: string;
    msgs: number;
    meanEffort: number;
    lastMessageId: string;
  }[];

  const ranked: RankedAuthor[] = authors
    .filter((author) => author.msgs >= minMsgs)
    .map((author) => ({
      id: author.id,
      lastMessageId: author.lastMessageId,
      msgs: author.msgs,
      meanEffort: author.meanEffort,
      composite: author.meanEffort * Math.log10(author.msgs),
      drag: (1 - author.meanEffort) * Math.log10(author.msgs),
    }));
  const top = (score: (author: RankedAuthor) => number): RankedAuthor[] =>
    [...ranked].sort((a, b) => score(b) - score(a)).slice(0, BOARD_SIZE);
  const topEffort = top((author) => author.meanEffort);
  const workhorses = top((author) => author.composite);
  const drains = top((author) => author.drag);

  const people = describeAuthors(guildId, [...topEffort, ...workhorses, ...drains]);
  const rows = (list: RankedAuthor[]): AuthorRow[] =>
    list.map((author) => ({
      id: author.id,
      display: people.get(author.id)?.display ?? `User ${author.id.slice(-6)}`,
      inGuild: people.get(author.id)?.inGuild ?? true,
      msgs: author.msgs,
      meanEffort: author.meanEffort,
      composite: author.composite,
      drag: author.drag,
    }));

  return {
    distinctAuthors: authors.length,
    minMsgs,
    topEffort: rows(topEffort),
    workhorses: rows(workhorses),
    drains: rows(drains),
  };
}

const MEASURE_COLUMNS = WEEKLY_MEASURES.map((measure) => measure.column).join(", ");

/** The weekly measures of every week that overlaps the window. */
export function getWeeklyMeasures(range: ResolvedRange): MeasureWeek[] {
  const rows = (researchDb()
    ?.prepare(
      `SELECT week_start, count, ${MEASURE_COLUMNS}
       FROM weekly_overlay
       WHERE week_start > ? AND week_start < ?
       ORDER BY week_start`
    )
    .all(range.startS - WEEK_S, range.endS) ?? []) as ({
    week_start: number;
    count: number;
  } & Record<WeeklyMeasure["column"], number>)[];

  return rows.map((row) => ({
    weekStart: row.week_start,
    iso: isoDay(row.week_start),
    count: row.count,
    values: Object.fromEntries(
      WEEKLY_MEASURES.map((measure) => [measure.key, row[measure.column]])
    ) as Record<WeeklyMeasureKey, number>,
  }));
}

function change(name: string, deltaPct: number): string {
  if (Math.abs(deltaPct) < TREND_NOISE_PCT) return `${name} is about the same`;
  return `${name} is ${deltaPct > 0 ? "up" : "down"} ${Math.abs(deltaPct).toFixed(1)}%`;
}

/**
 * The twelve weeks before `endS`, and the last four of them against the four
 * before. Null with fewer than eight weeks of scores.
 */
export function getRecentTrend(endS: number): QualityTrend | null {
  const weeks = (
    (researchDb()
      ?.prepare(
        `SELECT week_start AS weekStart, effort, substantiveness
         FROM weekly_overlay
         WHERE week_start < ?
         ORDER BY week_start DESC
         LIMIT ${TREND_WEEKS}`
      )
      .all(endS) ?? []) as { weekStart: number; effort: number; substantiveness: number }[]
  ).reverse();
  if (weeks.length < 2 * TREND_BLOCK) return null;

  const compare = (pick: (week: (typeof weeks)[number]) => number) => {
    const mean = (list: typeof weeks): number =>
      list.reduce((sum, week) => sum + pick(week), 0) / list.length;
    const current = mean(weeks.slice(-TREND_BLOCK));
    const prior = mean(weeks.slice(-2 * TREND_BLOCK, -TREND_BLOCK));
    return { current, prior, deltaPct: prior > 0 ? ((current - prior) / prior) * 100 : 0 };
  };
  const effort = compare((week) => week.effort);
  const substantiveness = compare((week) => week.substantiveness);

  return {
    weeks,
    effort,
    substantiveness,
    sentence:
      `${change("Effort", effort.deltaPct)} and ` +
      `${change("substantiveness", substantiveness.deltaPct)} against the four weeks before.`,
  };
}

/** Means over all weeks the job has built, weighted by their message counts. */
export function getAllTimeMeans(): AllTimeMeans | null {
  const row = researchDb()
    ?.prepare(
      `SELECT SUM(count) AS n,
              SUM(effort * count) AS effort,
              SUM(resonance * count) AS resonance,
              SUM(substantiveness * count) AS substantiveness
       FROM weekly_overlay`
    )
    .get() as
    { n: number | null; effort: number; resonance: number; substantiveness: number } | undefined;
  if (!row?.n) return null;
  return {
    effort: row.effort / row.n,
    resonance: row.resonance / row.n,
    substantiveness: row.substantiveness / row.n,
  };
}

/** What the job last wrote about itself. Null without a score file. */
export function getScoreStatus(): ScoreStatus | null {
  const scores = researchDb();
  if (!scores) return null;

  const meta = new Map(
    (scores.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map(
      (row) => [row.key, row.value]
    )
  );
  const numberOf = (key: string): number | null => {
    const value = Number(meta.get(key));
    return meta.has(key) && Number.isFinite(value) ? value : null;
  };
  // Two subqueries, so that each one is a single step along the primary key.
  const span = scores
    .prepare(
      `SELECT (SELECT MIN(created_at_s) FROM message_scores) AS oldestS,
              (SELECT MAX(created_at_s) FROM message_scores) AS newestS`
    )
    .get() as { oldestS: number | null; newestS: number | null };

  return {
    total: numberOf("total") ?? 0,
    pending: numberOf("pending") ?? 0,
    oldestS: span.oldestS,
    newestS: span.newestS,
    lastRunS: numberOf("last_run_s"),
  };
}
