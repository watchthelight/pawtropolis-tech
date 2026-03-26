/**
 * Pawtropolis Tech — migrations/056_qotd.ts
 * WHAT: Create QOTD (Question of the Day) suggestion system table
 * WHY: Community-driven QOTD suggestions — members suggest, staff approve/reject,
 *      staff pull random approved questions when they need QOTD ideas
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (uses IF NOT EXISTS / columnExists)
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate056Qotd(db: Database): void {
  logger.info("[migration 056] Starting: create QOTD tables");

  enableForeignKeys(db);

  // ── qotd_suggestion ─────────────────────────────────────────────────
  if (!tableExists(db, "qotd_suggestion")) {
    logger.info("[migration 056] Creating qotd_suggestion table");

    db.exec(`
      CREATE TABLE qotd_suggestion (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id          TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        question          TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending', 'approved', 'rejected', 'used')),
        short_code        TEXT NOT NULL,
        review_message_id TEXT,
        reviewed_by       TEXT,
        reviewed_at_s     INTEGER,
        reject_reason     TEXT,
        used_by           TEXT,
        used_at_s         INTEGER,
        created_at_s      INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);

    db.exec(`CREATE INDEX idx_qotd_suggestion_guild_status ON qotd_suggestion(guild_id, status)`);
    db.exec(`CREATE INDEX idx_qotd_suggestion_guild_user ON qotd_suggestion(guild_id, user_id)`);
    db.exec(`CREATE INDEX idx_qotd_suggestion_guild_code ON qotd_suggestion(guild_id, short_code)`);

    logger.info("[migration 056] qotd_suggestion table created");
  } else {
    logger.info("[migration 056] qotd_suggestion table already exists, skipping");
  }

  // ── guild_config columns ───────────────────────────────────────────
  if (!columnExists(db, "guild_config", "qotd_review_channel_id")) {
    logger.info("[migration 056] Adding guild_config.qotd_review_channel_id");
    db.exec(`ALTER TABLE guild_config ADD COLUMN qotd_review_channel_id TEXT`);
  }

  if (!columnExists(db, "guild_config", "qotd_role_id")) {
    logger.info("[migration 056] Adding guild_config.qotd_role_id");
    db.exec(`ALTER TABLE guild_config ADD COLUMN qotd_role_id TEXT`);
  }

  recordMigration(db, "056", "qotd");

  logger.info("[migration 056] Complete");
}
