/**
 * Migration 058: Invite labels + invite snapshot cache
 * WHAT: invite_label for friendly source names, invite_snapshot to persist cache across restarts
 * WHY: Review cards show invite source attribution; snapshot survives bot restarts so
 *      the diff-based tracking doesn't lose data on restart.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate058InviteLabels(db: Database): void {
  logger.info("[migration 058] Starting: invite labels + snapshot");

  db.exec(`
    CREATE TABLE IF NOT EXISTS invite_label (
      guild_id TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY (guild_id, invite_code)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invite_snapshot (
      guild_id TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0,
      inviter_id TEXT,
      updated_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, invite_code)
    )
  `);

  recordMigration(db, 58, "invite_labels");
  logger.info("[migration 058] Complete");
}
