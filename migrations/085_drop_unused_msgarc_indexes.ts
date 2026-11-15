/**
 * Pawtropolis Tech -- migrations/085_drop_unused_msgarc_indexes.ts
 * WHAT: Drops idx_msgarc_author_time and idx_msgarc_channel_time on messages_archive.
 * WHY: No statement uses them, and every archived message pays for them.
 *      Checked on 2026-11-15 (todo #00294):
 *       - The production planner was asked about every statement in the bot, the
 *         dashboard and the scripts that touches the table. All of them filter
 *         by guild or by message id, and none picks either index.
 *       - On a copy rebuilt from the production table's own keys, replaying the
 *         last 40,000 live messages took 6.8 s with the three indexes and 3.2 s
 *         with idx_msgarc_guild_time alone, and wrote 3.1 pages a row in place
 *         of 5.8.
 *       - The two indexes hold about 208 MB of a 1,227 MB file.
 *
 * SAFETY: Idempotent (DROP INDEX IF EXISTS). No row is touched. The file does
 *         not shrink: the freed pages are reused as the archive grows.
 *
 * TO UNDO: create them again. Each took about three seconds for 3.3 million
 *          rows on the dev machine, and writes wait while it runs.
 *   CREATE INDEX idx_msgarc_author_time ON messages_archive(author_id, created_at_s);
 *   CREATE INDEX idx_msgarc_channel_time ON messages_archive(channel_id, created_at_s);
 *          A query that groups by channel or by author over the whole archive
 *          could use them, but only when it names one with INDEXED BY. Left to
 *          itself the planner takes idx_msgarc_guild_time.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { indexExists, recordMigration, tableExists } from "./lib/helpers.js";

const DROPPED = ["idx_msgarc_author_time", "idx_msgarc_channel_time"];

export function migrate085DropUnusedMsgarcIndexes(db: Database): void {
  logger.info("[migration 085] Starting: drop two unused indexes on messages_archive");

  for (const name of DROPPED) db.exec(`DROP INDEX IF EXISTS ${name}`);

  recordMigration(db, "085", "drop_unused_msgarc_indexes");
  logger.info("[migration 085] Complete: drop two unused indexes on messages_archive");
}

/** Post-condition: the runner rolls the migration back when this returns false. */
export function verify085DropUnusedMsgarcIndexes(db: Database): boolean {
  if (DROPPED.some((name) => indexExists(db, name))) return false;
  // The index every read of the archive goes through has to be there still.
  return !tableExists(db, "messages_archive") || indexExists(db, "idx_msgarc_guild_time");
}
