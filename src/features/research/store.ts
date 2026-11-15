/**
 * Pawtropolis Tech -- src/features/research/store.ts
 * WHAT: The research results: one row of scores per message, one row per week
 *       and a few facts about the series itself, in a database file of its own.
 * WHY: The first version of the pipeline kept its input in the bot's
 *      database: a copy of every text, its context and 3 KB of vectors per
 *      message. That grew the file to 9.4 GB and hung the bot at start. Here
 *      only results are stored, about 100 bytes a message, and they live in
 *      data/research.db, so the bot's database, its backups, its replication
 *      and its start check are not touched by any of it.
 *
 *      Rows are keyed by time first. Every reader asks for a time range (the
 *      dashboard's windows, the job's slices), and that makes each of those a
 *      single run through the table, with no second index to keep.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";

export const WEEK_S = 7 * 86400;
// 1970-01-01 was a Thursday. Four days later is the first Monday.
const EPOCH_TO_MONDAY_S = 4 * 86400;

/** Start of the week (Monday 00:00 UTC) a time falls in. */
export function weekStartOf(timeS: number): number {
  return Math.floor((timeS - EPOCH_TO_MONDAY_S) / WEEK_S) * WEEK_S + EPOCH_TO_MONDAY_S;
}

/** log1p(replies) against log1p of the 95th percentile, capped at 1. */
export function resonanceOf(replyCount: number, replyP95: number): number {
  return Math.min(1, Math.log1p(replyCount) / (Math.log1p(replyP95) || 1));
}

/** What the old pipeline used until it had seen a reply. */
export const DEFAULT_REPLY_P95 = 5;

export interface Score {
  messageId: string;
  createdAtS: number;
  authorId: string;
  contentRev: number;
  effort: number;
  heuristic: number;
  novelty: number;
  notFiller: number;
  lexicalDensity: number;
  substantiveness: number;
}

export interface StoredScore extends Score {
  replyCount: number;
  resonance: number;
}

/** What the bookkeeping needs of a stored row. */
export interface ScoreKey {
  messageId: string;
  createdAtS: number;
  contentRev: number;
  replyCount: number;
}

export interface WeekRow {
  weekStart: number;
  count: number;
  effort: number;
  heuristic: number;
  resonance: number;
  medianLength: number;
  lexicalDiversity: number;
  questionRate: number;
  noRepeatSpam: number;
  noLowlistHit: number;
  replyRate: number;
  authorDistribution: number;
  substantiveness: number;
  novelty: number;
  notFiller: number;
  lexDensity: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS message_scores (
    created_at_s    INTEGER NOT NULL,
    message_id      TEXT    NOT NULL,
    author_id       TEXT    NOT NULL,
    content_rev     INTEGER NOT NULL,
    effort          REAL    NOT NULL,
    heuristic       REAL    NOT NULL,
    novelty         REAL    NOT NULL,
    not_filler      INTEGER NOT NULL,
    lexical_density REAL    NOT NULL,
    substantiveness REAL    NOT NULL,
    reply_count     INTEGER NOT NULL DEFAULT 0,
    resonance       REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (created_at_s, message_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS weekly_overlay (
    week_start          INTEGER PRIMARY KEY,
    count               INTEGER NOT NULL,
    effort              REAL    NOT NULL,
    heuristic           REAL    NOT NULL,
    resonance           REAL    NOT NULL,
    median_length       REAL    NOT NULL,
    lexical_diversity   REAL    NOT NULL,
    question_rate       REAL    NOT NULL,
    no_repeat_spam      REAL    NOT NULL,
    no_lowlist_hit      REAL    NOT NULL,
    reply_rate          REAL    NOT NULL,
    author_distribution REAL    NOT NULL,
    substantiveness     REAL    NOT NULL,
    novelty             REAL    NOT NULL,
    not_filler          REAL    NOT NULL,
    lex_density         REAL    NOT NULL,
    computed_at_s       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
`;

const WEEK_OF_ROW = `((created_at_s - ${EPOCH_TO_MONDAY_S}) / ${WEEK_S}) * ${WEEK_S} + ${EPOCH_TO_MONDAY_S}`;

export class Store {
  private readonly db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    // The dashboard reads this file while the job writes to it.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 30000");
    this.db.exec(SCHEMA);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }

  /**
   * Records what the series is made from on the first run and refuses to go on
   * when a later run comes with something else: another channel or another
   * model would silently mix two series in one file.
   */
  assertIdentity(identity: Record<string, string>): void {
    for (const [key, value] of Object.entries(identity)) {
      const stored = this.getMeta(key);
      if (stored === null) this.setMeta(key, value);
      else if (stored !== value) {
        throw new Error(
          `the score file belongs to another series: its ${key} is "${stored}", this run has "${value}". A new series needs a new file.`
        );
      }
    }
  }

  keysInRange(fromS: number, toS: number): ScoreKey[] {
    return this.db
      .prepare(
        `SELECT message_id AS messageId, created_at_s AS createdAtS, content_rev AS contentRev,
                reply_count AS replyCount
         FROM message_scores WHERE created_at_s >= ? AND created_at_s < ?`
      )
      .all(fromS, toS) as ScoreKey[];
  }

  scoresInRange(fromS: number, toS: number): StoredScore[] {
    return this.db
      .prepare(
        `SELECT message_id AS messageId, created_at_s AS createdAtS, author_id AS authorId,
                content_rev AS contentRev, effort, heuristic, novelty, not_filler AS notFiller,
                lexical_density AS lexicalDensity, substantiveness, reply_count AS replyCount,
                resonance
         FROM message_scores WHERE created_at_s >= ? AND created_at_s < ?`
      )
      .all(fromS, toS) as StoredScore[];
  }

  /** New rows start without replies. A redone row keeps the replies it has. */
  upsertScores(scores: Score[]): void {
    const statement = this.db.prepare(
      `INSERT INTO message_scores (created_at_s, message_id, author_id, content_rev, effort,
         heuristic, novelty, not_filler, lexical_density, substantiveness)
       VALUES (@createdAtS, @messageId, @authorId, @contentRev, @effort, @heuristic, @novelty,
         @notFiller, @lexicalDensity, @substantiveness)
       ON CONFLICT(created_at_s, message_id) DO UPDATE SET
         author_id = excluded.author_id, content_rev = excluded.content_rev,
         effort = excluded.effort, heuristic = excluded.heuristic, novelty = excluded.novelty,
         not_filler = excluded.not_filler, lexical_density = excluded.lexical_density,
         substantiveness = excluded.substantiveness`
    );
    this.db.transaction(() => {
      for (const score of scores) statement.run(score);
    })();
  }

  deleteScores(keys: Pick<ScoreKey, "messageId" | "createdAtS">[]): void {
    const statement = this.db.prepare(
      "DELETE FROM message_scores WHERE created_at_s = ? AND message_id = ?"
    );
    this.db.transaction(() => {
      for (const key of keys) statement.run(key.createdAtS, key.messageId);
    })();
  }

  setReplyCounts(
    updates: { messageId: string; createdAtS: number; replyCount: number }[],
    replyP95: number
  ): void {
    const statement = this.db.prepare(
      `UPDATE message_scores SET reply_count = ?, resonance = ?
       WHERE created_at_s = ? AND message_id = ?`
    );
    this.db.transaction(() => {
      for (const u of updates) {
        statement.run(u.replyCount, resonanceOf(u.replyCount, replyP95), u.createdAtS, u.messageId);
      }
    })();
  }

  /** The 95th percentile of the reply counts of the messages that got a reply. */
  replyP95(): number {
    const groups = this.db
      .prepare(
        `SELECT reply_count AS replyCount, COUNT(*) AS n FROM message_scores
         WHERE reply_count > 0 GROUP BY reply_count ORDER BY reply_count`
      )
      .all() as { replyCount: number; n: number }[];
    const total = groups.reduce((sum, g) => sum + g.n, 0);
    const position = Math.floor(total * 0.95);
    let seen = 0;
    for (const group of groups) {
      seen += group.n;
      if (position < seen) return group.replyCount;
    }
    return DEFAULT_REPLY_P95;
  }

  /** Writes every resonance again after the percentile moved. */
  rescaleResonance(replyP95: number): void {
    const counts = this.db
      .prepare(
        "SELECT DISTINCT reply_count AS replyCount FROM message_scores WHERE reply_count > 0"
      )
      .all() as { replyCount: number }[];
    const statement = this.db.prepare(
      "UPDATE message_scores SET resonance = ? WHERE reply_count = ?"
    );
    this.db.transaction(() => {
      for (const { replyCount } of counts) {
        statement.run(resonanceOf(replyCount, replyP95), replyCount);
      }
      this.db.exec(
        `UPDATE weekly_overlay SET resonance = (
           SELECT AVG(resonance) FROM message_scores
           WHERE created_at_s >= week_start AND created_at_s < week_start + ${WEEK_S})
         WHERE EXISTS (
           SELECT 1 FROM message_scores
           WHERE created_at_s >= week_start AND created_at_s < week_start + ${WEEK_S})`
      );
    })();
  }

  /** How many scored messages each week has, by week start. */
  scoreCountsByWeek(): Map<number, number> {
    const found = this.db
      .prepare(
        `SELECT ${WEEK_OF_ROW} AS weekStart, COUNT(*) AS n FROM message_scores GROUP BY weekStart`
      )
      .all() as { weekStart: number; n: number }[];
    return new Map(found.map((r) => [r.weekStart, r.n]));
  }

  weekCounts(): Map<number, number> {
    const found = this.db
      .prepare("SELECT week_start AS weekStart, count AS n FROM weekly_overlay")
      .all() as { weekStart: number; n: number }[];
    return new Map(found.map((r) => [r.weekStart, r.n]));
  }

  upsertWeek(week: WeekRow, nowS: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO weekly_overlay (week_start, count, effort, heuristic, resonance,
           median_length, lexical_diversity, question_rate, no_repeat_spam, no_lowlist_hit,
           reply_rate, author_distribution, substantiveness, novelty, not_filler, lex_density,
           computed_at_s)
         VALUES (@weekStart, @count, @effort, @heuristic, @resonance, @medianLength,
           @lexicalDiversity, @questionRate, @noRepeatSpam, @noLowlistHit, @replyRate,
           @authorDistribution, @substantiveness, @novelty, @notFiller, @lexDensity, @nowS)`
      )
      .run({ ...week, nowS });
  }

  deleteWeek(weekStart: number): void {
    this.db.prepare("DELETE FROM weekly_overlay WHERE week_start = ?").run(weekStart);
  }

  countScores(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM message_scores").get() as { n: number }).n;
  }

  /** Time of the oldest scored message, or null when nothing is scored. */
  firstScoreAt(): number | null {
    const row = this.db
      .prepare("SELECT created_at_s AS t FROM message_scores ORDER BY created_at_s LIMIT 1")
      .get() as { t: number } | undefined;
    return row?.t ?? null;
  }

  close(): void {
    this.db.close();
  }
}
