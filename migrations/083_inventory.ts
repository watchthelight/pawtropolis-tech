/**
 * Pawtropolis Tech -- migrations/083_inventory.ts
 * WHAT: Backend inventory ledger so reward roles can stack.
 * WHY: A Discord role is binary. A member who already holds the Emoji Ticket role and
 *      earns a second one from Patreon, Amari, or a Mimu purchase silently loses it.
 *      The ledger becomes the source of truth and the role becomes a transient delivery
 *      vehicle: the bot captures the role into inventory_items and re-issues it on
 *      /redeem.
 *
 * TABLES:
 *  - inventory_items       current stack count per user per item
 *  - inventory_log         append-only audit of every credit and debit
 *  - pending_item_capture  grace-window queue; survives restarts, unlike setTimeout
 *  - inventory_grant_keys  one-shot dedup keys so reward-bot re-syncs cannot inflate
 *
 * SAFETY: Idempotent (CREATE TABLE IF NOT EXISTS), additive only, no data loss.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate083Inventory(db: Database): void {
  logger.info("[migration 083] Starting: inventory ledger");

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, user_id, item_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      delta INTEGER NOT NULL,
      source TEXT NOT NULL,
      actor_id TEXT,
      reason TEXT,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // UNIQUE(guild,user,role) collapses a burst of guildMemberUpdate events for the same
  // role into one pending capture. Re-adds during the grace window are not new items.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_item_capture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      grant_key TEXT,
      detected_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      remove_at_s INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      UNIQUE(guild_id, user_id, role_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_grant_keys (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      grant_key TEXT NOT NULL,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, user_id, grant_key)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pending_item_capture_due
    ON pending_item_capture(remove_at_s)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_log_user
    ON inventory_log(guild_id, user_id, created_at_s DESC)
  `);

  // getConfig() does SELECT * FROM guild_config, so the toggles have to be real columns.
  const cols = new Set(
    (db.pragma("table_info(guild_config)") as Array<{ name: string }>).map((c) => c.name)
  );
  const additions: Array<[string, string]> = [
    ["inventory_enabled", "TEXT"],
    ["inventory_grace_seconds", "INTEGER"],
    ["inventory_debounce_seconds", "INTEGER"],
    ["inventory_source_bot_ids_json", "TEXT"],
    ["inventory_extra_roles_json", "TEXT"],
  ];
  for (const [name, type] of additions) {
    if (cols.has(name)) continue;
    db.exec(`ALTER TABLE guild_config ADD COLUMN ${name} ${type}`);
    logger.info({ column: name }, "[migration 083] Added guild_config column");
  }

  recordMigration(db, "083", "inventory");
  logger.info("[migration 083] Complete: inventory ledger");
}

/**
 * Post-condition: the runner rolls the whole migration back when this returns false.
 * Guards against a body that half-applies without throwing (#00141).
 */
export function verify083Inventory(db: Database): boolean {
  const tables = ["inventory_items", "inventory_log", "pending_item_capture", "inventory_grant_keys"];
  for (const t of tables) {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(t);
    if (!row) return false;
  }
  const cols = new Set(
    (db.pragma("table_info(guild_config)") as Array<{ name: string }>).map((c) => c.name)
  );
  return cols.has("inventory_enabled") && cols.has("inventory_extra_roles_json");
}
