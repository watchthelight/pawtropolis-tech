/**
 * Migration 068: Track ticket greeting message ID
 * WHAT: Adds nullable `greeting_message_id TEXT` column to the `ticket` table
 *       (created by migration 067).
 * WHY: Claim/unclaim and close handlers edit the original greeting embed in
 *      place (append "Claimed by …" field, swap Claim ↔ Unclaim button). We
 *      need the message ID to fetch and edit. Existing rows (none in production
 *      yet, but possible during dev iteration) get NULL — claim/close fall
 *      back to posting follow-up messages instead.
 * SAFETY: Idempotent additive column. No data loss path.
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration } from "./lib/helpers.js";

export function migrate068TicketGreetingMessageId(db: Database): void {
  logger.info("[migration 068] Starting: ticket.greeting_message_id");
  if (!columnExists(db, "ticket", "greeting_message_id")) {
    db.exec(`ALTER TABLE ticket ADD COLUMN greeting_message_id TEXT`);
    logger.info("[migration 068] Added ticket.greeting_message_id");
  } else {
    logger.info("[migration 068] greeting_message_id already exists, skipping");
  }
  recordMigration(db, "068", "ticket_greeting_message_id");
  logger.info("[migration 068] Complete");
}
