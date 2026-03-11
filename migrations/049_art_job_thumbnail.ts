/**
 * Pawtropolis Tech — migrations/049_art_job_thumbnail.ts
 * WHAT: Add thumbnail_url column to art_job table
 * WHY: Store the latest uploaded art preview for each job
 *
 * SAFETY:
 *  - Idempotent: checks column existence before ALTER
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate049ArtJobThumbnail(db: Database): void {
  enableForeignKeys(db);

  if (!columnExists(db, "art_job", "thumbnail_url")) {
    db.prepare("ALTER TABLE art_job ADD COLUMN thumbnail_url TEXT").run();
    console.log("[migration:049] Added art_job.thumbnail_url");
  }

  recordMigration(db, "049", "art_job_thumbnail");
  console.log("[migration:049] art_job_thumbnail complete");
}
