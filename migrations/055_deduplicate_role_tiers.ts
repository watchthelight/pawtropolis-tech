/**
 * Migration 055: Deduplicate role_tiers entries
 * WHAT: Remove duplicate role_tiers rows — each level role has 2 entries with
 *       different tier_names (e.g., "Legendary Fur" vs "Legendary Fur ‹‹ LVL 80 ››").
 * WHY: Setup script ran twice with different naming conventions. Duplicates cause
 *       incorrect counts on dashboard (INC-005) and data quality issues.
 *
 * SAFETY:
 *  - Keeps the descriptive "‹‹ LVL N ››" variant, deletes the bare name
 *  - Logs every deletion for audit trail
 *  - Idempotent: safe to re-run (no duplicates = no deletions)
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate055DeduplicateRoleTiers(db: Database): void {
  logger.info("[migration 055] Starting: deduplicate role_tiers");

  // Find role_ids with multiple entries
  const dupes = db.prepare(`
    SELECT role_id, COUNT(*) as cnt
    FROM role_tiers
    WHERE tier_type = 'level'
    GROUP BY role_id
    HAVING cnt > 1
  `).all() as Array<{ role_id: string; cnt: number }>;

  if (dupes.length === 0) {
    logger.info("[migration 055] No duplicate role_tiers found — nothing to do");
    recordMigration(db, "055", "deduplicate_role_tiers");
    return;
  }

  logger.info(`[migration 055] Found ${dupes.length} role_ids with duplicate entries`);

  let deleted = 0;
  for (const dupe of dupes) {
    // Get all entries for this role_id
    const entries = db.prepare(`
      SELECT id, tier_name FROM role_tiers
      WHERE tier_type = 'level' AND role_id = ?
      ORDER BY id
    `).all(dupe.role_id) as Array<{ id: number; tier_name: string }>;

    // Keep the descriptive name (contains "‹‹"), delete the bare one
    const toKeep = entries.find(e => e.tier_name.includes("‹‹")) ?? entries[0];
    const toDelete = entries.filter(e => e.id !== toKeep.id);

    for (const entry of toDelete) {
      db.prepare("DELETE FROM role_tiers WHERE id = ?").run(entry.id);
      logger.info(`[migration 055] Deleted: "${entry.tier_name}" (id=${entry.id}), kept: "${toKeep.tier_name}" (id=${toKeep.id})`);
      deleted++;
    }
  }

  logger.info(`[migration 055] Deleted ${deleted} duplicate role_tiers entries`);
  recordMigration(db, "055", "deduplicate_role_tiers");
}
