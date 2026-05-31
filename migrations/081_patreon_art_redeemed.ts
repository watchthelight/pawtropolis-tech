/**
 * Pawtropolis Tech -- migrations/081_patreon_art_redeemed.ts
 * WHAT: Add quantity_redeemed to patreon_art_granted.
 * WHY: The ticket role is a single binary "has a ticket" marker, but a tier may
 *      grant quantity > 1 (e.g. Legendary Fiona = 2 emoji). quantity_granted is a
 *      high-water mark, so after the first redemption removed the role the periodic
 *      sweep saw granted >= entitlement and never re-granted the second ticket -
 *      the highest tier was permanently under-paid (#00077 / #00085). Tracking
 *      redemptions lets the sweep re-grant while remaining = granted - redeemed > 0.
 *
 * SAFETY: Idempotent (PRAGMA-checked), additive only, no data loss. Existing rows
 *         default to 0 redeemed, i.e. all previously granted tickets are treated as
 *         still outstanding.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate081PatreonArtRedeemed(db: Database): void {
  logger.info("[migration 081] Starting: add quantity_redeemed to patreon_art_granted");

  const cols = db.pragma("table_info(patreon_art_granted)") as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "quantity_redeemed")) {
    db.exec(`ALTER TABLE patreon_art_granted ADD COLUMN quantity_redeemed INTEGER NOT NULL DEFAULT 0`);
    logger.info("[migration 081] Added quantity_redeemed column to patreon_art_granted");
  } else {
    logger.info("[migration 081] quantity_redeemed column already exists, skipping");
  }

  recordMigration(db, "081", "patreon_art_redeemed");
  logger.info("[migration 081] Complete");
}
