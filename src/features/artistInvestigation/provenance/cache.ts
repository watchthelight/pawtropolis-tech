/**
 * Pawtropolis Tech -- src/features/artistInvestigation/provenance/cache.ts
 * WHAT: Lookup results kept by image hash, service and variant.
 * WHY: Re-running the command on the same ticket should not spend the lookup
 *      services' rate limits again. A week is long enough to cover a review and
 *      short enough that new reposts still show up.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { LIMITS } from "../config.js";
import type { ImageVariant, ProvenanceServiceName, RawMatch } from "../types.js";

export function readCache(
  db: Database,
  sha256: string,
  service: ProvenanceServiceName,
  variant: ImageVariant,
  nowMs: number
): RawMatch[] | null {
  const row = db
    .prepare(
      `SELECT result_json FROM artist_provenance_cache
       WHERE image_sha256 = ? AND service = ? AND variant = ? AND fetched_at_s >= ?`
    )
    .get(sha256, service, variant, Math.floor(nowMs / 1000) - LIMITS.cacheTtlSeconds) as
    | { result_json: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.result_json);
    return Array.isArray(parsed) ? (parsed as RawMatch[]) : null;
  } catch {
    return null;
  }
}

export function writeCache(
  db: Database,
  sha256: string,
  service: ProvenanceServiceName,
  variant: ImageVariant,
  matches: RawMatch[],
  nowMs: number
): void {
  db.prepare(
    `INSERT INTO artist_provenance_cache (image_sha256, service, variant, result_json, fetched_at_s)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(image_sha256, service, variant)
     DO UPDATE SET result_json = excluded.result_json, fetched_at_s = excluded.fetched_at_s`
  ).run(sha256, service, variant, JSON.stringify(matches), Math.floor(nowMs / 1000));
}

/** Drop entries past their time to live. Returns how many went. */
export function pruneCache(db: Database, nowMs: number): number {
  return db
    .prepare(`DELETE FROM artist_provenance_cache WHERE fetched_at_s < ?`)
    .run(Math.floor(nowMs / 1000) - LIMITS.cacheTtlSeconds).changes;
}
