/**
 * Pawtropolis Tech — migrations/048_nsfw_alert_role_config.ts
 * WHAT: Add nsfw_alert_role_id column to guild_config
 * WHY: Make the NSFW alert ping role configurable instead of hardcoded
 *
 * SAFETY:
 *  - Idempotent: checks column existence before ALTER
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate048NsfwAlertRoleConfig(db: Database): void {
  enableForeignKeys(db);

  if (!columnExists(db, "guild_config", "nsfw_alert_role_id")) {
    db.prepare("ALTER TABLE guild_config ADD COLUMN nsfw_alert_role_id TEXT").run();
    console.log("[migration:048] Added guild_config.nsfw_alert_role_id");
  }

  recordMigration(db, "048", "nsfw_alert_role_config");
  console.log("[migration:048] nsfw_alert_role_config complete");
}
