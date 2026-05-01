/**
 * Migration 073: Drop the AI/AD/AU triggers added by 072
 *
 * WHY: The triggers fire on every action_log INSERT/UPDATE/DELETE and write
 *      into the FTS5 inverted index. Bot writes action_log on most Discord
 *      events, and the FTS work — even though small per write — interacted
 *      badly with the bot's existing event-loop pressure on the t3.small box.
 *      Slash commands started returning "application did not respond"
 *      because the bot couldn't ack within Discord's 3s window.
 *
 * KEEP: action_log_fts (the table) + the 15K backfilled rows. Audit-log
 *       search still hits the FTS index for older entries; entries written
 *       AFTER trigger removal won't appear in FTS — getAuditLog already
 *       OR's the FTS hit ids with a parallel user_cache name LIKE, so
 *       newer rows still surface via the actor/subject ID columns when
 *       the search term looks like a snowflake. We accept reduced recall
 *       on free-text reason search for newer rows in exchange for bot
 *       responsiveness.
 *
 * FOLLOW-UP: re-introduce as a periodic batched backfill (cron in bot
 *           or a separate worker) instead of synchronous triggers.
 *
 * SAFETY: Idempotent — DROP IF EXISTS is a no-op when triggers are absent.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate073DropActionLogFtsTriggers(db: Database): void {
  logger.info("[migration 073] Starting: drop_action_log_fts_triggers");

  db.exec(`DROP TRIGGER IF EXISTS action_log_ai`);
  db.exec(`DROP TRIGGER IF EXISTS action_log_ad`);
  db.exec(`DROP TRIGGER IF EXISTS action_log_au`);

  recordMigration(db, "073", "drop_action_log_fts_triggers");
  logger.info("[migration 073] Complete: drop_action_log_fts_triggers");
}
