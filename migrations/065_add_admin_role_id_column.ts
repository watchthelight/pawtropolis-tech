/**
 * Migration 065: Add admin_role_id column to guild_config
 * WHAT: Adds nullable admin_role_id TEXT column to guild_config.
 * WHY: scheduler/staleApplicationCheck.ts:70 references g.admin_role_id for the
 *      72h escalation tier (pings admin/leadership instead of gatekeeper). The
 *      column was added to the SQL query but never to the schema, breaking the
 *      stale-alert scheduler entirely (errors every 30 min).
 *
 * SAFETY: Idempotent (PRAGMA-checked), additive only, no data loss. Existing
 *         guilds get NULL which the query handles via COALESCE/null fallback.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate065AddAdminRoleIdColumn(db: Database): void {
  logger.info("[migration 065] Starting: add admin_role_id column to guild_config");

  const cols = db.pragma("table_info(guild_config)") as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "admin_role_id")) {
    db.exec(`ALTER TABLE guild_config ADD COLUMN admin_role_id TEXT`);
    logger.info("[migration 065] Added admin_role_id column to guild_config");
  } else {
    logger.info("[migration 065] admin_role_id column already exists, skipping");
  }

  recordMigration(db, "065", "add_admin_role_id_column");
  logger.info("[migration 065] Complete");
}
