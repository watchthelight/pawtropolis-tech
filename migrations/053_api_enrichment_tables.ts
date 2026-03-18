/**
 * Migration 053: API enrichment tables
 * WHAT: guild_snapshot, guild_snapshot_log, channel_cache, invite_usage tables
 * WHY: Bot writes live Discord gateway/API data to SQLite so the web dashboard
 *      can display real member counts, online users, channel names, and growth sources
 *      without direct Discord API access.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE/INDEX IF NOT EXISTS
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate053ApiEnrichmentTables(db: Database): void {
  logger.info("[migration 053] Starting: API enrichment tables");

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_snapshot (
      guild_id TEXT PRIMARY KEY,
      member_count INTEGER NOT NULL,
      online_count INTEGER,
      boost_count INTEGER,
      boost_tier INTEGER,
      channel_count INTEGER,
      role_count INTEGER,
      voice_users_now INTEGER,
      updated_at_s INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_snapshot_log (
      guild_id TEXT NOT NULL,
      date TEXT NOT NULL,
      member_count INTEGER,
      online_count INTEGER,
      boost_count INTEGER,
      boost_tier INTEGER,
      voice_users_now INTEGER,
      PRIMARY KEY (guild_id, date)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_cache (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type INTEGER NOT NULL,
      parent_id TEXT,
      updated_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invite_usage (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      invite_code TEXT,
      inviter_id TEXT,
      joined_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_invite_guild_joined ON invite_usage(guild_id, joined_at_s)`);

  recordMigration(db, "053", "api_enrichment_tables");
  logger.info("[migration 053] Complete");
}
