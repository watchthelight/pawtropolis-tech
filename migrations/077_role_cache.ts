/**
 * Migration 077: role_cache table
 * WHAT: Caches Discord role id -> name/color so the web dashboard can resolve
 *       <@&id> mentions to readable chips without hitting the Discord API.
 * WHY: Welcome message editor renders role pings inline like Discord does.
 *      Channel cache already exists (migration 053); roles get the same treatment.
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE/INDEX IF NOT EXISTS
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate077RoleCache(db: Database): void {
  logger.info("[migration 077] Starting: role_cache");

  db.exec(`
    CREATE TABLE IF NOT EXISTS role_cache (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      mentionable INTEGER NOT NULL DEFAULT 0,
      managed INTEGER NOT NULL DEFAULT 0,
      updated_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_role_cache_guild ON role_cache(guild_id)`);

  recordMigration(db, "077", "role_cache");
  logger.info("[migration 077] Complete");
}
