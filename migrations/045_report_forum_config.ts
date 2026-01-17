/**
 * Pawtropolis Tech — migrations/045_report_forum_config.ts
 * WHAT: Add report_forum_id column to guild_config for ambassador content reports
 * WHY: Enable configurable forum channel where content violation reports are posted
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks column existence first)
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Add report_forum_id column to guild_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate045ReportForumConfig(db: Database): void {
  logger.info("[migration 045] Starting: add report_forum_id column to guild_config");

  enableForeignKeys(db);

  if (!columnExists(db, "guild_config", "report_forum_id")) {
    logger.info("[migration 045] Adding report_forum_id column to guild_config");
    db.exec(`ALTER TABLE guild_config ADD COLUMN report_forum_id TEXT`);
    logger.info("[migration 045] report_forum_id column added");
  } else {
    logger.info("[migration 045] report_forum_id column already exists, skipping");
  }

  recordMigration(db, "045", "report_forum_config");

  logger.info("[migration 045] Complete");
}
