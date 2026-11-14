/**
 * Pawtropolis Tech -- migrations/084_artist_investigation.ts
 * WHAT: Storage for /investigate-artist: a usage ledger and a lookup cache.
 * WHY: The command spends money on the Claude API and must refuse to run past a
 *      monthly cap, so every run's tokens and estimated cost are recorded.
 *      Reverse image lookups are rate limited and slow, so results are kept by
 *      image hash and reused for a week.
 *
 * TABLES:
 *  - artist_investigation_run   one row per run: who, where, model, tokens, cost. No ticket content.
 *  - artist_provenance_cache    lookup results keyed by image SHA-256, service and variant
 *
 * SAFETY: Idempotent (CREATE TABLE IF NOT EXISTS), additive only, no data loss.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate084ArtistInvestigation(db: Database): void {
  logger.info("[migration 084] Starting: artist investigation ledger and lookup cache");

  db.exec(`
    CREATE TABLE IF NOT EXISTS artist_investigation_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      invoked_by TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      image_count INTEGER NOT NULL DEFAULT 0,
      lookup_count INTEGER NOT NULL DEFAULT 0,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // The budget guard sums one calendar month at a time.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_artist_investigation_run_created
    ON artist_investigation_run(created_at_s)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS artist_provenance_cache (
      image_sha256 TEXT NOT NULL,
      service TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'original',
      result_json TEXT NOT NULL,
      fetched_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (image_sha256, service, variant)
    )
  `);

  recordMigration(db, "084", "artist_investigation");
  logger.info("[migration 084] Complete: artist investigation ledger and lookup cache");
}

/** Post-condition: the runner rolls the migration back when this returns false. */
export function verify084ArtistInvestigation(db: Database): boolean {
  for (const table of ["artist_investigation_run", "artist_provenance_cache"]) {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table);
    if (!row) return false;
  }
  return true;
}
