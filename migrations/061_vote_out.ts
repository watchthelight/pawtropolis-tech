/**
 * Migration 061: Vote Out
 * WHAT: Creates vote_out table for multi-mod consensus rejection + config threshold.
 * WHY: Vote Out requires tracking individual mod votes per application.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS + columnExists guard
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration } from "./lib/helpers.js";

export function migrate061VoteOut(db: Database): void {
  logger.info("[migration 061] Starting: vote_out");

  db.exec(`
    CREATE TABLE IF NOT EXISTS vote_out (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(app_id, voter_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vote_out_app ON vote_out(app_id)
  `);

  if (!columnExists(db, "guild_config", "vote_out_threshold")) {
    db.prepare("ALTER TABLE guild_config ADD COLUMN vote_out_threshold INTEGER DEFAULT 2").run();
    logger.info("[migration 061] Added guild_config.vote_out_threshold");
  }

  recordMigration(db, "061", "vote_out");
  logger.info("[migration 061] Complete");
}
