/**
 * Pawtropolis Tech — migrations/047_nsfw_reviewed_tracking.ts
 * WHAT: Add reviewed_by and reviewed_at columns to nsfw_flags
 * WHY: Track who dismissed an NSFW flag and when (audit trail)
 *
 * SAFETY:
 *  - Idempotent: checks column existence before ALTER
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate047NsfwReviewedTracking(db: Database): void {
  enableForeignKeys(db);

  const columns = [
    { name: "reviewed_by", type: "TEXT" },
    { name: "reviewed_at", type: "TEXT" },
  ];

  for (const col of columns) {
    if (!columnExists(db, "nsfw_flags", col.name)) {
      db.prepare(`ALTER TABLE nsfw_flags ADD COLUMN ${col.name} ${col.type}`).run();
      console.log(`[migration:047] Added nsfw_flags.${col.name}`);
    }
  }

  recordMigration(db, "047", "nsfw_reviewed_tracking");
  console.log("[migration:047] nsfw_reviewed_tracking complete");
}
