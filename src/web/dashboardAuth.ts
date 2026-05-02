// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/web/dashboardAuth.ts
 * WHAT: Pure authorization helpers for the dashboard API.
 * WHY: src/web/dashboardApi.ts is the bot's second mutation surface (alongside
 *      Discord interactions). Pulling tier ordering, hierarchy comparison, and
 *      body validation into a sibling module makes the rules independently
 *      testable without spinning up Fastify or a Discord client.
 *
 * No imports of fastify, discord.js, or db here on purpose.
 */

/**
 * Role tier ordering, lowest index = highest authority.
 *
 * Mirrors the seven-tier hierarchy used elsewhere in the bot. Owners outrank
 * everyone; "none" outranks no one. `viewer` exists for read-only dashboard
 * access (it cannot pass any write check).
 *
 * If you change the order, keep it in sync with:
 *  - docs/PERMS-MATRIX.md (canonical hierarchy doc)
 *  - tests/web/dashboardAuth.test.ts (asserts ordering)
 */
export const TIER_ORDER = [
  "owner",
  "cm",
  "cdl",
  "sa",
  "admin",
  "sm",
  "mod",
  "jm",
  "gk",
  "viewer",
  "none",
] as const;

export type TierName = (typeof TIER_ORDER)[number];

/**
 * Returns true if `userTier` ranks at or above `minTier`.
 * Unknown tiers fail closed: if either input is not in TIER_ORDER, the
 * function returns false.
 *
 * Examples:
 *   hasMinTier("owner", "gk") === true
 *   hasMinTier("admin", "gk") === true
 *   hasMinTier("gk", "admin") === false
 *   hasMinTier("viewer", "gk") === false
 *   hasMinTier("hacker", "gk") === false  (unknown user tier)
 *   hasMinTier("admin", "secret") === false (unknown min tier)
 */
export function hasMinTier(userTier: string, minTier: string): boolean {
  const userIdx = (TIER_ORDER as readonly string[]).indexOf(userTier);
  const minIdx = (TIER_ORDER as readonly string[]).indexOf(minTier);
  if (userIdx === -1 || minIdx === -1) return false;
  return userIdx <= minIdx;
}

/**
 * Validate that a request body has the required string fields. Returns the
 * list of missing field names, or an empty array if all present.
 *
 * Each field must be a non-empty string. Numeric, boolean, null, and undefined
 * values count as missing. This matches the dashboardApi convention of
 * `if (!userId || !tier || !appId) return reply.code(400)...`.
 */
export function missingStringFields<T extends Record<string, unknown>>(
  body: T | null | undefined,
  fields: readonly (keyof T & string)[],
): string[] {
  const missing: string[] = [];
  if (!body) return [...fields];
  for (const field of fields) {
    const value = body[field];
    if (typeof value !== "string" || value.length === 0) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Validate that a request body has the required positive-integer fields
 * (used by ticketId-style endpoints). Returns missing field names.
 */
export function missingIntegerFields<T extends Record<string, unknown>>(
  body: T | null | undefined,
  fields: readonly (keyof T & string)[],
): string[] {
  const missing: string[] = [];
  if (!body) return [...fields];
  for (const field of fields) {
    const value = body[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      missing.push(field);
    }
  }
  return missing;
}
