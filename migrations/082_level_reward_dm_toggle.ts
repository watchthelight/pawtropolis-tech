/**
 * Pawtropolis Tech -- migrations/082_level_reward_dm_toggle.ts
 * WHAT: Add level_reward_dm_enabled column to guild_config
 * WHY: Guilds using Amaribot for level-up announcements want the bot's
 *      reward DM off to avoid duplicate notifications. Default stays on.
 * HOW: ALTER TABLE ADD COLUMN with DEFAULT 1 (enabled)
 *
 * SAFETY:
 *  - Idempotent: checks column existence before adding
 *  - Additive only: no data loss, existing guilds keep DMs on
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate082LevelRewardDmToggle(db: Database): void {
  logger.info("[migration 082] Starting: add level_reward_dm_enabled to guild_config");

  enableForeignKeys(db);

  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 082] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );
    recordMigration(db, "082", "level_reward_dm_toggle");
    return;
  }

  if (!columnExists(db, "guild_config", "level_reward_dm_enabled")) {
    logger.info("[migration 082] Adding level_reward_dm_enabled column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN level_reward_dm_enabled INTEGER DEFAULT 1`);
    logger.info("[migration 082] level_reward_dm_enabled added");
  } else {
    logger.info("[migration 082] level_reward_dm_enabled already exists, skipping");
  }

  recordMigration(db, "082", "level_reward_dm_toggle");

  logger.info("[migration 082] Complete");
}
