/**
 * Pawtropolis Tech — migrations/074_member_role_snapshots.ts
 * WHAT: Snapshot table for member roles captured at guildMemberRemove time.
 * WHY: Lets /restoreroles re-grant prior roles when a user rejoins after leaving / kick / ban.
 * TABLES:
 *  - member_role_snapshots: append-only history of role state at removal
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *
 * SAFETY:
 *  - Idempotent: tableExists / indexExists guards
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, indexExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate074MemberRoleSnapshots(db: Database): void {
  logger.info("[migration 074] Starting: member_role_snapshots");

  enableForeignKeys(db);

  if (!tableExists(db, "member_role_snapshots")) {
    logger.info("[migration 074] Creating member_role_snapshots table");
    db.exec(`
      CREATE TABLE member_role_snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        role_ids      TEXT NOT NULL,
        removal_type  TEXT NOT NULL DEFAULT 'unknown',
        reason        TEXT,
        executor_id   TEXT,
        removed_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        restored_at   INTEGER,
        restored_by   TEXT
      )
    `);
  }

  // Index serves the "most recent snapshot for (guild, user)" lookup used by /restoreroles
  // and the dedupe-within-5s check in the snapshot writer.
  if (!indexExists(db, "idx_msr_user_recent")) {
    logger.info("[migration 074] Creating idx_msr_user_recent");
    db.exec(`
      CREATE INDEX idx_msr_user_recent
        ON member_role_snapshots(guild_id, user_id, removed_at DESC)
    `);
  }

  recordMigration(db, "074", "member_role_snapshots");
  logger.info("[migration 074] Complete");
}
