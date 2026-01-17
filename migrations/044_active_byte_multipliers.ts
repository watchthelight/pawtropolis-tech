/**
 * Pawtropolis Tech — migrations/044_active_byte_multipliers.ts
 * WHAT: Create active_byte_multipliers table for tracking XP boost expirations
 * WHY: Enable automatic expiration of byte token multiplier roles without manual staff intervention
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (uses IF NOT EXISTS)
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/*
 * CONTEXT: The byte token system allows users to redeem XP multiplier tokens.
 * When a user redeems a token (e.g., "Byte Token [Common]"), they receive
 * a multiplier role (e.g., "[2x] Byte") for a limited duration.
 *
 * This table tracks active multipliers so the scheduler can automatically
 * remove expired roles without staff intervention.
 *
 * Token durations:
 * - Common: 2x for 12 hours
 * - Rare: 3x for 24 hours
 * - Epic: 5x for 48 hours
 * - Legendary: 5x for 72 hours
 * - Mythic: 10x for 168 hours (1 week)
 */

/**
 * Migration: Create active_byte_multipliers table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate044ActiveByteMultipliers(db: Database): void {
  logger.info("[migration 044] Starting: create active_byte_multipliers table");

  enableForeignKeys(db);

  if (!tableExists(db, "active_byte_multipliers")) {
    logger.info("[migration 044] Creating active_byte_multipliers table");

    /*
     * The active_byte_multipliers table tracks currently active XP multipliers.
     *
     * Key design decisions:
     * - UNIQUE(guild_id, user_id) ensures one active multiplier per user per guild
     * - expires_at as Unix timestamp for easy comparison in cleanup queries
     * - token_rarity preserved for audit trail even after role changes
     * - redeemed_by tracks who clicked the confirm button (usually same as user_id)
     */
    db.exec(`
      CREATE TABLE active_byte_multipliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Guild and user identification
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,

        -- Multiplier role details
        multiplier_role_id TEXT NOT NULL,
        multiplier_name TEXT NOT NULL,
        multiplier_value INTEGER NOT NULL,

        -- Expiration tracking
        expires_at INTEGER NOT NULL,

        -- Audit trail
        token_rarity TEXT NOT NULL CHECK(token_rarity IN (
          'common',
          'rare',
          'epic',
          'legendary',
          'mythic'
        )),
        redeemed_by TEXT NOT NULL,

        -- Timestamp
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

        -- One active multiplier per user per guild
        UNIQUE(guild_id, user_id)
      )
    `);

    // Primary query: find expired multipliers for cleanup
    db.exec(`CREATE INDEX idx_active_byte_expires ON active_byte_multipliers(expires_at)`);

    // Secondary query: lookup user's active multiplier
    db.exec(`CREATE INDEX idx_active_byte_user ON active_byte_multipliers(guild_id, user_id)`);

    logger.info("[migration 044] active_byte_multipliers table created");
  } else {
    logger.info("[migration 044] active_byte_multipliers table already exists, skipping");
  }

  recordMigration(db, "044", "active_byte_multipliers");

  logger.info("[migration 044] Complete");
}
