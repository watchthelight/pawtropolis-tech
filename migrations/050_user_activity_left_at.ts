/**
 * Migration 050: Add left_at column to user_activity
 * WHAT: Tracks when members leave the guild
 * WHY: Pulse "Total Tracked" was counting all-time members (8,261) instead of current members (~6,416)
 *
 * SAFETY:
 *  - Idempotent: uses column existence check
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration } from "./lib/helpers.js";

export function migrate050UserActivityLeftAt(db: Database): void {
  logger.info("[migration 050] Starting: add left_at to user_activity");

  if (!columnExists(db, "user_activity", "left_at")) {
    db.exec(`ALTER TABLE user_activity ADD COLUMN left_at INTEGER`);
    logger.info("[migration 050] Added left_at column");
  } else {
    logger.info("[migration 050] left_at column already exists, skipping");
  }

  recordMigration(db, "050", "user_activity_left_at");
  logger.info("[migration 050] Complete");
}
