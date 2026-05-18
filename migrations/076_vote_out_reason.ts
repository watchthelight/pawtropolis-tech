/**
 * Migration 076: Vote Out Reason
 * WHAT: Adds nullable `reason` column to vote_out so each voter can attach
 *       a short justification at vote time.
 * WHY: Mods asked for vote rationale so consensus rejections leave an audit
 *      trail beyond just "two people clicked the button".
 *
 * SAFETY:
 *  - Idempotent: columnExists guard
 *  - Additive only: nullable column, existing rows keep NULL reason
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration } from "./lib/helpers.js";

export function migrate076VoteOutReason(db: Database): void {
  logger.info("[migration 076] Starting: vote_out_reason");

  if (!columnExists(db, "vote_out", "reason")) {
    db.prepare("ALTER TABLE vote_out ADD COLUMN reason TEXT").run();
    logger.info("[migration 076] Added vote_out.reason");
  }

  recordMigration(db, "076", "vote_out_reason");
  logger.info("[migration 076] Complete");
}
