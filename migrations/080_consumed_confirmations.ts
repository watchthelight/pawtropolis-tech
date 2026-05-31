/**
 * Pawtropolis Tech -- migrations/080_consumed_confirmations.ts
 * WHAT: Create consumed_confirmations, a single-use ledger for confirmation
 *       button clicks keyed by the random confirmId embedded in the customId.
 * WHY: /redeemreward's confirm button had no reentrancy guard - a double-click
 *      (or two staff clicking the shared, non-ephemeral confirmation) fired two
 *      distinct interactions that each rotated the artist queue and created a
 *      duplicate art_job. Atomically consuming the confirmId makes the confirm
 *      idempotent (#00081).
 *
 * SAFETY: Idempotent (CREATE TABLE IF NOT EXISTS); additive.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate080ConsumedConfirmations(db: Database): void {
  logger.info("[migration 080] Starting: create consumed_confirmations table");

  db.exec(`
    CREATE TABLE IF NOT EXISTS consumed_confirmations (
      confirm_id   TEXT PRIMARY KEY,
      consumed_at_s INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  recordMigration(db, "080", "consumed_confirmations");
  logger.info("[migration 080] Complete");
}
