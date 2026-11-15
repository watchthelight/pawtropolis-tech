/**
 * Pawtropolis Tech -- migrations/086_drop_empty_study_tables.ts
 * WHAT: Drops five score tables of the old chat-quality study where they are
 *       empty: general_messages_effort, general_messages_resonance,
 *       general_messages_score, general_messages_substantiveness and
 *       general_messages_overlay_weekly.
 * WHY: On the host the study's tables were dropped on 2026-05-15. Its scripts
 *      kept running from cron, and five of them create their output table when
 *      it is missing, so the host got five empty tables back that nothing
 *      reads. The crontab lines were removed on 2026-11-15, and the research
 *      job that took the study's place keeps its scores in a file of its own
 *      (todo #00295).
 *
 *      Checked on the host on 2026-11-15: each of the five holds 0 rows. No
 *      statement in src/ or web/src names one of them.
 *
 * SAFETY: A table that holds a row stays, and its indexes with it. A
 *         developer's copy of the database has the study's results in these
 *         tables, and there the migration changes nothing. No row is deleted
 *         anywhere. Idempotent.
 *
 *         The study's other tables (raw, ctx, embed, gold, label) are not
 *         touched, and neither is user_names: scripts/charts and scripts/report
 *         read it.
 *
 * TO UNDO: nothing has to be restored. Each of the study's scoring scripts
 *          creates its table again when it runs (CREATE TABLE IF NOT EXISTS).
 *          The indexes that migration 070 added to three of the tables served
 *          the dashboard's old Quality page, which read them; no code does now.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { getRowCount, recordMigration, tableExists } from "./lib/helpers.js";

const STUDY_SCORE_TABLES = [
  "general_messages_effort",
  "general_messages_resonance",
  "general_messages_score",
  "general_messages_substantiveness",
  "general_messages_overlay_weekly",
];

export function migrate086DropEmptyStudyTables(db: Database): void {
  logger.info("[migration 086] Starting: drop the empty score tables of the old study");

  const dropped: string[] = [];
  const kept: string[] = [];
  for (const name of STUDY_SCORE_TABLES) {
    if (!tableExists(db, name)) continue;
    if (getRowCount(db, name) > 0) {
      kept.push(name);
      continue;
    }
    db.exec(`DROP TABLE ${name}`);
    dropped.push(name);
  }

  recordMigration(db, "086", "drop_empty_study_tables");
  logger.info(
    { dropped, kept },
    "[migration 086] Complete: drop the empty score tables of the old study"
  );
}

/** Post-condition: the runner rolls the migration back when this returns false. */
export function verify086DropEmptyStudyTables(db: Database): boolean {
  return STUDY_SCORE_TABLES.every((name) => !tableExists(db, name) || getRowCount(db, name) > 0);
}
