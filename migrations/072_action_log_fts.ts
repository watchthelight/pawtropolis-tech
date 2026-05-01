/**
 * Migration 072: FTS5 index over action_log searchable columns
 * WHAT: Contentless FTS5 virtual table mirroring reason / app_code /
 *       actor_id / subject_id from action_log, plus AI/AD/AU triggers
 *       to keep the index in sync with row mutations. Initial backfill
 *       seeds the index from existing rows.
 * WHY: Audit-log search currently runs an 8-LIKE OR chain across
 *       action_log + 2 user_cache JOINs. On a multi-million-row
 *       table that's seconds-to-minutes per query. FTS5 MATCH is
 *       sub-second.
 *
 * SAFETY: Idempotent. CREATE … IF NOT EXISTS gates everything.
 *         Backfill runs only when the FTS table is empty (first
 *         migration application).
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate072ActionLogFts(db: Database): void {
  logger.info("[migration 072] Starting: action_log_fts");

  // Contentless FTS table — stores only the inverted index, content lives
  // in action_log rows. rowid = action_log.id.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS action_log_fts USING fts5(
      reason, app_code, actor_id, subject_id,
      content='action_log',
      content_rowid='id',
      tokenize='porter unicode61'
    )
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS action_log_ai AFTER INSERT ON action_log BEGIN
      INSERT INTO action_log_fts(rowid, reason, app_code, actor_id, subject_id)
      VALUES (new.id, new.reason, new.app_code, new.actor_id, new.subject_id);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS action_log_ad AFTER DELETE ON action_log BEGIN
      INSERT INTO action_log_fts(action_log_fts, rowid, reason, app_code, actor_id, subject_id)
      VALUES ('delete', old.id, old.reason, old.app_code, old.actor_id, old.subject_id);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS action_log_au AFTER UPDATE ON action_log BEGIN
      INSERT INTO action_log_fts(action_log_fts, rowid, reason, app_code, actor_id, subject_id)
      VALUES ('delete', old.id, old.reason, old.app_code, old.actor_id, old.subject_id);
      INSERT INTO action_log_fts(rowid, reason, app_code, actor_id, subject_id)
      VALUES (new.id, new.reason, new.app_code, new.actor_id, new.subject_id);
    END;
  `);

  // Backfill only if the FTS table is empty — otherwise we'd duplicate rows
  // on re-application.
  const ftsCount = (db.prepare(`SELECT COUNT(*) AS c FROM action_log_fts`).get() as { c: number }).c;
  if (ftsCount === 0) {
    logger.info("[migration 072] Backfilling action_log_fts (one-time)");
    db.exec(`
      INSERT INTO action_log_fts(rowid, reason, app_code, actor_id, subject_id)
      SELECT id, reason, app_code, actor_id, subject_id FROM action_log
    `);
    const after = (db.prepare(`SELECT COUNT(*) AS c FROM action_log_fts`).get() as { c: number }).c;
    logger.info({ rows: after }, "[migration 072] Backfill complete");
  } else {
    logger.info({ existing: ftsCount }, "[migration 072] FTS table non-empty — skipping backfill");
  }

  recordMigration(db, "072", "action_log_fts");
  logger.info("[migration 072] Complete: action_log_fts");
}
