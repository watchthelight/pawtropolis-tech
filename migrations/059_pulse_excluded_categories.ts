/**
 * Migration 059: Pulse excluded categories
 * WHAT: Add pulse_excluded_category_ids_json column to guild_config
 * WHY: Lets staff mark Discord categories (e.g. "Staff", "Moderation") to exclude
 *      from newsletter stats — prevents inflated numbers and staff channel name leaks.
 *
 * SAFETY:
 *  - Idempotent: uses columnExists check
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration } from "./lib/helpers.js";

export function migrate059PulseExcludedCategories(db: Database): void {
  logger.info("[migration 059] Starting: pulse excluded categories");

  if (!columnExists(db, "guild_config", "pulse_excluded_category_ids_json")) {
    db.exec(`ALTER TABLE guild_config ADD COLUMN pulse_excluded_category_ids_json TEXT`);
    logger.info("[migration 059] Added pulse_excluded_category_ids_json column");
  }

  recordMigration(db, "059", "pulse_excluded_categories");
  logger.info("[migration 059] Complete");
}
