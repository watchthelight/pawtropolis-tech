/**
 * Migration 054: Add banner NSFW + AI detection columns to avatar_scan
 * WHAT: Extends avatar_scan with banner scanning and AI-generated detection scores
 * WHY: Dashboard review cards need 4 scores: avatar NSFW, banner NSFW, avatar AI, banner AI
 *
 * SAFETY:
 *  - Idempotent: columnExists checks before each ALTER
 *  - Additive only: no data loss
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration } from "./lib/helpers.js";

export function migrate054ScanBannerAndAiColumns(db: Database): void {
  logger.info("[migration 054] Starting: banner + AI scan columns");

  const cols: Array<[string, string]> = [
    ["banner_url", "TEXT"],
    ["banner_nsfw_score", "REAL"],
    ["banner_final_pct", "INTEGER DEFAULT 0"],
    ["banner_reason", "TEXT"],
    ["banner_evidence_hard", "TEXT"],
    ["banner_evidence_soft", "TEXT"],
    ["banner_evidence_safe", "TEXT"],
    ["avatar_ai_score", "REAL"],
    ["banner_ai_score", "REAL"],
  ];

  for (const [name, type] of cols) {
    if (!columnExists(db, "avatar_scan", name)) {
      db.exec(`ALTER TABLE avatar_scan ADD COLUMN ${name} ${type}`);
      logger.info(`[migration 054] Added ${name} column`);
    }
  }

  recordMigration(db, "054", "scan_banner_and_ai_columns");
  logger.info("[migration 054] Complete");
}
