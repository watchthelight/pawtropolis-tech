/**
 * Pawtropolis Tech — migrations/046_extend_user_cache_profile.ts
 * WHAT: Add profile columns to user_cache for dashboard profile panel
 * WHY: Dashboard needs banner, accent color, join date, and account creation date
 *
 * SAFETY:
 *  - Idempotent: checks column existence before ALTER
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export default function migrate(db: Database): void {
  enableForeignKeys(db);

  const columns = [
    { name: "banner_url", type: "TEXT" },
    { name: "accent_color", type: "INTEGER" },
    { name: "joined_at", type: "INTEGER" },
    { name: "created_at", type: "INTEGER" },
  ];

  for (const col of columns) {
    if (!columnExists(db, "user_cache", col.name)) {
      db.prepare(`ALTER TABLE user_cache ADD COLUMN ${col.name} ${col.type}`).run();
      console.log(`[migration:046] Added user_cache.${col.name}`);
    }
  }

  recordMigration(db, "046", "extend_user_cache_profile");
  console.log("[migration:046] extend_user_cache_profile complete");
}
