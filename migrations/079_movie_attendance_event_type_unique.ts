/**
 * Pawtropolis Tech -- migrations/079_movie_attendance_event_type_unique.ts
 * WHAT: Rebuild movie_attendance so its uniqueness key includes event_type:
 *       UNIQUE(guild_id, user_id, event_date) -> UNIQUE(guild_id, user_id, event_date, event_type).
 * WHY: movie_attendance stores both 'movie' and 'game' rows (migration 040 added
 *      event_type). With the old 3-column unique key, a user who attends a movie
 *      night and a game night on the SAME calendar day collides: whichever event
 *      finalizes second silently REPLACEs the other's row (INSERT OR REPLACE),
 *      destroying attendance/qualification history and corrupting tier counts.
 *
 * HOW: SQLite cannot drop a table-level UNIQUE constraint in place, so we do the
 *      standard rebuild. We reuse the table's OWN stored CREATE statement from
 *      sqlite_master (which already reflects every ALTER ADD COLUMN) and only
 *      rewrite the UNIQUE clause, so column types, defaults, and AUTOINCREMENT are
 *      preserved exactly. Data is copied verbatim (column order is unchanged), then
 *      the secondary event_type index is recreated.
 *
 * SAFETY:
 *  - Idempotent: skips the rebuild if event_type is already in the unique key.
 *  - Widening the key only (adds a column) -> all existing rows stay valid.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, columnExists, indexExists, recordMigration } from "./lib/helpers.js";

const UNIQUE_3COL = /UNIQUE\s*\(\s*guild_id\s*,\s*user_id\s*,\s*event_date\s*\)/i;

export function migrate079MovieAttendanceEventTypeUnique(db: Database): void {
  logger.info("[migration 079] Starting: add event_type to movie_attendance unique key");

  if (!tableExists(db, "movie_attendance")) {
    logger.info("[migration 079] movie_attendance table absent, nothing to do");
    recordMigration(db, "079", "movie_attendance_event_type_unique");
    return;
  }

  if (!columnExists(db, "movie_attendance", "event_type")) {
    // Migration 040 (which adds event_type) must run first. If it has not, do not
    // attempt to widen the key against a column that does not exist.
    logger.warn("[migration 079] event_type column missing; skipping (run migration 040 first)");
    recordMigration(db, "079", "movie_attendance_event_type_unique");
    return;
  }

  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'movie_attendance'`)
    .get() as { sql: string } | undefined;

  if (!row?.sql || !UNIQUE_3COL.test(row.sql)) {
    // Either already rebuilt (event_type in the key) or an unexpected shape we
    // should not blindly rewrite. Record and move on.
    logger.info("[migration 079] No 3-column UNIQUE(guild_id,user_id,event_date) found; assuming already migrated");
    recordMigration(db, "079", "movie_attendance_event_type_unique");
    return;
  }

  const newTableSql = row.sql
    .replace(/CREATE\s+TABLE\s+"?movie_attendance"?/i, "CREATE TABLE movie_attendance_new")
    .replace(UNIQUE_3COL, "UNIQUE(guild_id, user_id, event_date, event_type)");

  logger.info("[migration 079] Rebuilding movie_attendance with 4-column unique key");
  db.exec(newTableSql);
  db.exec(`INSERT INTO movie_attendance_new SELECT * FROM movie_attendance`);
  db.exec(`DROP TABLE movie_attendance`);
  db.exec(`ALTER TABLE movie_attendance_new RENAME TO movie_attendance`);

  // Recreate the secondary event_type index dropped with the old table.
  if (!indexExists(db, "idx_movie_attendance_event_type")) {
    db.exec(`
      CREATE INDEX idx_movie_attendance_event_type
      ON movie_attendance(guild_id, event_type, event_date)
    `);
  }

  recordMigration(db, "079", "movie_attendance_event_type_unique");
  logger.info("[migration 079] Complete");
}
