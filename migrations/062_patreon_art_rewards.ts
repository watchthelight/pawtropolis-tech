/**
 * Migration 062: Patreon Art Rewards
 * WHAT: Creates tables for tracking Patreon-based art ticket grants.
 * WHY: Automate art ticket role assignment for Patreon tiers with delta-based
 *      dedup to prevent over/under-granting on upgrade/downgrade/resub.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate062PatreonArtRewards(db: Database): void {
  logger.info("[migration 062] Starting: patreon_art_rewards");

  // Dedup / state tracking: one row per user per art type.
  // quantity_granted is the high-water mark — never decremented.
  db.exec(`
    CREATE TABLE IF NOT EXISTS patreon_art_granted (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      art_type TEXT NOT NULL,
      quantity_granted INTEGER NOT NULL DEFAULT 0,
      last_granted_at_s INTEGER,
      UNIQUE(guild_id, user_id, art_type)
    )
  `);

  // Audit log: one row per grant event. Filled over time, never backfilled.
  db.exec(`
    CREATE TABLE IF NOT EXISTS patreon_art_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      art_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      patreon_tier TEXT NOT NULL,
      reason TEXT,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_patreon_art_log_user
    ON patreon_art_log(guild_id, user_id)
  `);

  recordMigration(db, "062", "patreon_art_rewards");
  logger.info("[migration 062] Complete: patreon_art_rewards");
}
