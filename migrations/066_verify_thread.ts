/**
 * Migration 066: Per-user verify thread infrastructure
 * WHAT:
 *   - Adds nullable `verify_thread_parent_id TEXT` to guild_config — the hidden
 *     parent text channel where per-user private verify threads are created.
 *   - Adds nullable `unverified_rules_channel_id TEXT` to guild_config — the
 *     channel whose messages get replicated into each verify thread so the user
 *     reads the same rules they used to see in the public lobby.
 *   - Creates `verify_thread` table that maps (guild_id, user_id) → thread_id
 *     and tracks lifecycle state. PRIMARY KEY enforces idempotency: re-running
 *     the create-thread flow for an existing user is a no-op.
 *
 * WHY: Replaces the public-facing `[13] Unverified Area` lobby (where scammers
 *      could enumerate other unverified users via channel member sidebars) with
 *      per-user private threads invisible to everyone except the joining user.
 *      See plan: per-user private thread verification system.
 *
 * SAFETY: Idempotent column adds (PRAGMA-checked), additive only, no data
 *         loss. Existing guilds get NULL for the new columns; the threadGate
 *         feature short-circuits when these columns are unset, so the bot's
 *         current behavior is unchanged until staff explicitly configures the
 *         parent channel via /gate set-verify-thread-parent.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate066VerifyThread(db: Database): void {
  logger.info("[migration 066] Starting: per-user verify thread infrastructure");

  const cols = db.pragma("table_info(guild_config)") as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "verify_thread_parent_id")) {
    db.exec(`ALTER TABLE guild_config ADD COLUMN verify_thread_parent_id TEXT`);
    logger.info("[migration 066] Added verify_thread_parent_id column to guild_config");
  } else {
    logger.info("[migration 066] verify_thread_parent_id column already exists, skipping");
  }
  if (!cols.some((c) => c.name === "unverified_rules_channel_id")) {
    db.exec(`ALTER TABLE guild_config ADD COLUMN unverified_rules_channel_id TEXT`);
    logger.info("[migration 066] Added unverified_rules_channel_id column to guild_config");
  } else {
    logger.info("[migration 066] unverified_rules_channel_id column already exists, skipping");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS verify_thread (
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      thread_id   TEXT NOT NULL,
      state       TEXT NOT NULL DEFAULT 'created',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_verify_thread_thread_id ON verify_thread(thread_id)`);
  logger.info("[migration 066] Ensured verify_thread table + idx_verify_thread_thread_id");

  recordMigration(db, "066", "verify_thread");
  logger.info("[migration 066] Complete");
}
