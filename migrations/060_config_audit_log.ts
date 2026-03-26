/**
 * Migration 060: Config audit log
 * WHAT: Tracks who changed config fields, when, and from what value.
 * WHY: Dashboard config editing needs an audit trail for accountability.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate060ConfigAuditLog(db: Database): void {
  logger.info("[migration 060] Starting: config audit log");

  db.exec(`
    CREATE TABLE IF NOT EXISTS config_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      field_key TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT NOT NULL DEFAULT 'dashboard',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_config_audit_guild
    ON config_audit_log(guild_id, created_at DESC)
  `);

  recordMigration(db, "060", "config_audit_log");
  logger.info("[migration 060] Complete");
}
