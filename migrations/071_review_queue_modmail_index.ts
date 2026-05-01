/**
 * Migration 071: Review queue modmail-EXISTS index
 * WHAT: Adds (guild_id, user_id, status) covering index on modmail_ticket so the
 *       review-queue's correlated EXISTS lookups become a single index probe per
 *       application row instead of scanning the (guild_id, status) partition.
 *       Also adds (ticket_id) index on modmail_message if not already present
 *       (idx_modmail_message_ticket_id from 063 covers it; this is a no-op fence).
 *
 * SAFETY: Idempotent, additive only.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate071ReviewQueueModmailIndex(db: Database): void {
  logger.info("[migration 071] Starting: review_queue_modmail_index");

  // Review-queue EXISTS pattern: WHERE guild_id=? AND user_id=? AND status='open'.
  // The existing idx (guild_id, status, user_id) from 034 serves it but scans more.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_modmail_ticket_guild_user_status
    ON modmail_ticket(guild_id, user_id, status)
  `);

  recordMigration(db, "071", "review_queue_modmail_index");
  logger.info("[migration 071] Complete: review_queue_modmail_index");
}
