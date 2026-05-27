/**
 * Migration 063: Dashboard Query Performance Indexes
 * WHAT: Adds composite indexes for hot dashboard queries (stats, modmail, audit).
 * WHY: Stats page, modmail thread listing, and audit queries scan action_log and
 *      modmail_message frequently. These indexes cover the most common WHERE + ORDER BY patterns.
 *
 * SAFETY: Idempotent (IF NOT EXISTS), additive only, no data loss.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate063DashboardQueryIndexes(db: Database): void {
  logger.info("[migration 063] Starting: dashboard_query_indexes");

  // Stats queries filter by actor_id + guild_id + created_at_s (per-mod stats, time ranges)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_action_log_actor_guild_time
    ON action_log(actor_id, guild_id, created_at_s DESC)
  `);

  // Pulse/audit queries filter by guild_id + created_at_s (time-range aggregation)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_action_log_guild_time
    ON action_log(guild_id, created_at_s DESC)
  `);

  // Modmail message lookups by ticket (thread message listing, latest message subqueries)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_modmail_message_ticket_id
    ON modmail_message(ticket_id, id DESC)
  `);

  // Modmail message by ticket + created_at for chronological thread view
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_modmail_message_ticket_time
    ON modmail_message(ticket_id, created_at DESC)
  `);

  recordMigration(db, "063", "dashboard_query_indexes");
  logger.info("[migration 063] Complete: dashboard_query_indexes");
}
