/**
 * Pawtropolis Tech — migrations/057_level_reward_dedup.ts
 * WHAT: Create dedicated level_reward_granted table for bulletproof dedup
 * WHY: INC-005 — level rewards duplicated because dedup markers in role_assignments
 *      were missing for 150+ pre-fix grants. This table uses a UNIQUE constraint
 *      so INSERT OR IGNORE is atomic and race-proof.
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (uses IF NOT EXISTS)
 *  - Backfill uses INSERT OR IGNORE (no duplicates)
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate057LevelRewardDedup(db: Database): void {
  logger.info("[migration 057] Starting: create level_reward_granted table");

  enableForeignKeys(db);

  if (!tableExists(db, "level_reward_granted")) {
    logger.info("[migration 057] Creating level_reward_granted table");

    db.exec(`
      CREATE TABLE level_reward_granted (
        guild_id      TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        level         INTEGER NOT NULL,
        granted_at_s  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, user_id, level)
      )
    `);

    db.exec(
      `CREATE INDEX idx_level_reward_granted_guild_user ON level_reward_granted(guild_id, user_id)`
    );

    logger.info("[migration 057] Table created");

    // Backfill from existing role_assignments entries.
    // This captures ALL historical grants (including pre-dedup-marker grants)
    // so Amaribot re-syncs won't re-trigger rewards for users who already got them.
    const backfill = db.prepare(`
      INSERT OR IGNORE INTO level_reward_granted (guild_id, user_id, level, granted_at_s)
      SELECT
        guild_id,
        user_id,
        CAST(REPLACE(REPLACE(reason, 'level_', ''), '_reward', '') AS INTEGER) as level,
        MIN(created_at) as granted_at_s
      FROM role_assignments
      WHERE reason LIKE 'level_%_reward'
      AND action = 'add'
      GROUP BY guild_id, user_id, REPLACE(REPLACE(reason, 'level_', ''), '_reward', '')
    `);

    const result = backfill.run();
    logger.info(
      { rowsBackfilled: result.changes },
      "[migration 057] Backfilled level_reward_granted from role_assignments"
    );
  } else {
    logger.info("[migration 057] level_reward_granted table already exists, skipping");
  }

  recordMigration(db, "057", "level_reward_dedup");
  logger.info("[migration 057] Complete");
}
