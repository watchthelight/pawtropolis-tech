/**
 * Migration 064: Thin Line Verification
 * WHAT: Creates verified_users table for first responder / military honor-system verification.
 * WHY: Users self-verify via /verify DM flow and receive the Thin Line cosmetic role.
 *      Answers are logged for accountability — misuse results in warns/ban.
 *
 * SAFETY: Idempotent (IF NOT EXISTS), additive only, no data loss.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate064IdmeVerification(db: Database): void {
  logger.info("[migration 064] Starting: thin_line_verification");

  db.exec(`
    CREATE TABLE IF NOT EXISTS verified_users (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id          TEXT NOT NULL,
      discord_user_id   TEXT NOT NULL,
      category          TEXT NOT NULL,
      verified_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, discord_user_id)
    )
  `);

  recordMigration(db, "064", "idme_verification");
  logger.info("[migration 064] Complete: thin_line_verification");
}
