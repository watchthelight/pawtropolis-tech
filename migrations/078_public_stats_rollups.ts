/**
 * Migration 078: Public Stats Observatory rollup tables
 * WHAT: Precomputed rollup tables for the public, zero-JS /observatory stats page.
 * WHY: The page must read ONLY small precomputed tables so request-time render is
 *      sub-millisecond and trivially cacheable. The heavy GROUP BY aggregation runs
 *      out-of-band in scripts/refresh-public-stats.ts (src/features/statsObservatory/refresh.ts),
 *      never at request time.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS only.
 *  - Additive only: no data loss, no changes to existing tables.
 *  - All days are 'YYYY-MM-DD' UTC text to match guild_snapshot_log.date.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate078PublicStatsRollups(db: Database): void {
  logger.info("[migration 078] Starting: public stats rollup tables");

  // 1) Spine: one wide row per guild per UTC day. Hero, KPI band, and the
  //    membership/message/voice/decision trend charts all read slices of this.
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      guild_id            TEXT NOT NULL,
      day                 TEXT NOT NULL,
      member_count        INTEGER,
      member_count_delta  INTEGER,
      joins               INTEGER NOT NULL DEFAULT 0,
      leaves              INTEGER NOT NULL DEFAULT 0,
      cumulative_net      INTEGER,
      message_count       INTEGER NOT NULL DEFAULT 0,
      message_count_prev7 INTEGER,
      active_authors      INTEGER NOT NULL DEFAULT 0,
      active_authors_7d   INTEGER,
      voice_minutes       INTEGER NOT NULL DEFAULT 0,
      dec_approve         INTEGER NOT NULL DEFAULT 0,
      dec_reject          INTEGER NOT NULL DEFAULT 0,
      dec_kick            INTEGER NOT NULL DEFAULT 0,
      apps_submitted      INTEGER NOT NULL DEFAULT 0,
      apps_approved       INTEGER NOT NULL DEFAULT 0,
      refreshed_at_s      INTEGER NOT NULL,
      PRIMARY KEY (guild_id, day)
    )
  `);

  // 2) Hour x day heatmap, 168 cells per guild (rolling window snapshot).
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_heatmap (
      guild_id  TEXT NOT NULL,
      dow       INTEGER NOT NULL,
      hour      INTEGER NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, dow, hour)
    )
  `);

  // 3) Join-week cohort retention (small: weeks x 5 offsets).
  db.exec(`
    CREATE TABLE IF NOT EXISTS cohort_retention (
      guild_id    TEXT NOT NULL,
      cohort_week TEXT NOT NULL,
      week_offset INTEGER NOT NULL,
      cohort_size INTEGER NOT NULL,
      retained    INTEGER NOT NULL,
      PRIMARY KEY (guild_id, cohort_week, week_offset)
    )
  `);

  // 4) Tenure histogram snapshot (recomputed each run).
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenure_buckets (
      guild_id     TEXT NOT NULL,
      bucket       TEXT NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL,
      PRIMARY KEY (guild_id, bucket)
    )
  `);

  // 5) Per-channel daily message counts (top-5 + other computed at render).
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_daily (
      guild_id     TEXT NOT NULL,
      day          TEXT NOT NULL,
      channel_id   TEXT NOT NULL,
      channel_name TEXT,
      msg_count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day, channel_id)
    )
  `);

  // 6) Event participation per event-date/type.
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_daily (
      guild_id        TEXT NOT NULL,
      event_date      TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      qualified_count INTEGER NOT NULL DEFAULT 0,
      total_count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, event_date, event_type)
    )
  `);

  // 7) QOTD weekly funnel.
  db.exec(`
    CREATE TABLE IF NOT EXISTS qotd_weekly (
      guild_id  TEXT NOT NULL,
      week      TEXT NOT NULL,
      submitted INTEGER NOT NULL DEFAULT 0,
      approved  INTEGER NOT NULL DEFAULT 0,
      used      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, week)
    )
  `);

  // 8) Reaction emoji leaderboard (windowed snapshot).
  db.exec(`
    CREATE TABLE IF NOT EXISTS reaction_emoji (
      guild_id TEXT NOT NULL,
      emoji    TEXT NOT NULL,
      count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, emoji)
    )
  `);

  // 9) Moderator leaderboard snapshot. display_label holds the anonymized
  //    handle for the public page; moderator_id stays for joins/debugging.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mod_leaderboard (
      guild_id      TEXT NOT NULL,
      moderator_id  TEXT NOT NULL,
      display_label TEXT,
      accepts       INTEGER NOT NULL DEFAULT 0,
      rejects       INTEGER NOT NULL DEFAULT 0,
      kicks         INTEGER NOT NULL DEFAULT 0,
      p50_s         REAL,
      p95_s         REAL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, moderator_id)
    )
  `);

  // 10) Single freshness marker the footer reads.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rollup_meta (
      guild_id       TEXT PRIMARY KEY,
      refreshed_at_s INTEGER NOT NULL
    )
  `);

  recordMigration(db, "078", "public_stats_rollups");
  logger.info("[migration 078] Complete");
}
