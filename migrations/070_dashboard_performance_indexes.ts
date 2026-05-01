/**
 * Migration 070: Dashboard Performance Indexes
 * WHAT: Adds covering/partial indexes for hot Pulse, Stats, and Quality dashboard reads.
 * WHY: These pages aggregate over million-row message tables. The added indexes avoid
 *      unnecessary table lookups and speed up cold time-window changes.
 *
 * SAFETY: Idempotent, additive only.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate070DashboardPerformanceIndexes(db: Database): void {
  logger.info("[migration 070] Starting: dashboard_performance_indexes");

  // Quality overview/timeseries scan effort by time and immediately need id + score.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gme_time_id_score
    ON general_messages_effort(created_at_s, id, score)
  `);

  // Quality joins read resonance/heuristic scores by message id.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gmres_id_score
    ON general_messages_resonance(id, score)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gms_id_score
    ON general_messages_score(id, score)
  `);

  // Quality leaderboards and distinct-author counts only care about human authors.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gmr_human_time_author_id
    ON general_messages_raw(created_at_s, author_id, id)
    WHERE is_bot = 0
  `);

  // Backfill status repeatedly asks for human text messages with context/embed rows.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gmr_human_text_id
    ON general_messages_raw(id)
    WHERE is_bot = 0 AND length(content) > 0
  `);

  // Pulse aggregates by time, then groups by user/channel. Cover those columns.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_activity_guild_time_user_channel
    ON message_activity(guild_id, created_at_s, user_id, channel_id)
  `);

  // Stats/application funnel queries filter applications by guild + creation time.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_application_guild_created
    ON application(guild_id, created_at)
  `);

  recordMigration(db, "070", "dashboard_performance_indexes");
  logger.info("[migration 070] Complete: dashboard_performance_indexes");
}
