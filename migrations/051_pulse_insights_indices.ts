/**
 * Migration 051: Add indices for Pulse insights engine
 * WHAT: Indices on user_activity(joined_at) and user_activity(left_at) for time-range queries
 * WHY: Insights engine runs many time-windowed aggregations on user_activity — without these
 *      indices, every query full-scans the table. message_activity already has (guild_id, created_at_s).
 *
 * SAFETY:
 *  - Idempotent: CREATE INDEX IF NOT EXISTS
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate051PulseInsightsIndices(db: Database): void {
  logger.info("[migration 051] Starting: pulse insights indices");

  db.exec(`CREATE INDEX IF NOT EXISTS idx_ua_guild_joined ON user_activity(guild_id, joined_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ua_guild_left ON user_activity(guild_id, left_at)`);

  recordMigration(db, "051", "pulse_insights_indices");
  logger.info("[migration 051] Complete");
}
