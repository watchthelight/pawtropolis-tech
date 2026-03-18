/**
 * Migration 052: Create voice_session table
 * WHAT: Tracks all voice channel sessions (join/leave) for newsletter stats and insights
 * WHY: Newsletter shows "N/A" for voice minutes because no tracking exists.
 *      The existing movie/game night tracking only covers event-specific channels.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate052VoiceSession(db: Database): void {
  logger.info("[migration 052] Starting: voice_session table");

  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      joined_at_s INTEGER NOT NULL,
      left_at_s INTEGER,
      UNIQUE(guild_id, user_id, channel_id, joined_at_s)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_vs_guild_joined ON voice_session(guild_id, joined_at_s)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vs_guild_user ON voice_session(guild_id, user_id)`);

  recordMigration(db, "052", "voice_session");
  logger.info("[migration 052] Complete");
}
