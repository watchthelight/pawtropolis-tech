/**
 * Pawtropolis Tech — src/store/byteMultiplierStore.ts
 * WHAT: Storage layer for tracking active byte token multipliers
 * WHY: Enable automatic expiration of XP multiplier roles without staff intervention
 * FLOWS:
 *  - getActiveMultiplier(guildId, userId) → ActiveMultiplier | null
 *  - upsertActiveMultiplier(data) → void (creates or replaces)
 *  - removeExpiredMultipliers() → ExpiredMultiplier[] (for scheduler)
 *  - removeUserMultiplier(guildId, userId) → boolean
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Types
// ============================================================================

export type TokenRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export interface ActiveMultiplier {
  id: number;
  guild_id: string;
  user_id: string;
  multiplier_role_id: string;
  multiplier_name: string;
  multiplier_value: number;
  expires_at: number;
  token_rarity: TokenRarity;
  redeemed_by: string;
  created_at: number;
}

export interface UpsertMultiplierParams {
  guildId: string;
  userId: string;
  multiplierRoleId: string;
  multiplierName: string;
  multiplierValue: number;
  expiresAt: number;
  tokenRarity: TokenRarity;
  redeemedBy: string;
}

export interface ExpiredMultiplier {
  guild_id: string;
  user_id: string;
  multiplier_role_id: string;
  multiplier_name: string;
  token_rarity: TokenRarity;
  expires_at: number;
}

// ============================================================================
// Prepared Statements
// ============================================================================

const getActiveMultiplierStmt = db.prepare(`
  SELECT * FROM active_byte_multipliers
  WHERE guild_id = ? AND user_id = ?
`);

const upsertMultiplierStmt = db.prepare(`
  INSERT INTO active_byte_multipliers (
    guild_id, user_id, multiplier_role_id, multiplier_name,
    multiplier_value, expires_at, token_rarity, redeemed_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    multiplier_role_id = excluded.multiplier_role_id,
    multiplier_name = excluded.multiplier_name,
    multiplier_value = excluded.multiplier_value,
    expires_at = excluded.expires_at,
    token_rarity = excluded.token_rarity,
    redeemed_by = excluded.redeemed_by,
    created_at = strftime('%s', 'now')
`);

// WHY SELECT before DELETE? We need the full row data to remove the role in Discord.
// DELETE ... RETURNING would be ideal but better-sqlite3 doesn't support it well.
const getExpiredMultipliersStmt = db.prepare(`
  SELECT guild_id, user_id, multiplier_role_id, multiplier_name, token_rarity, expires_at
  FROM active_byte_multipliers
  WHERE expires_at <= ?
`);

const deleteExpiredMultipliersStmt = db.prepare(`
  DELETE FROM active_byte_multipliers
  WHERE expires_at <= ?
`);

const removeUserMultiplierStmt = db.prepare(`
  DELETE FROM active_byte_multipliers
  WHERE guild_id = ? AND user_id = ?
`);

const getAllActiveMultipliersStmt = db.prepare(`
  SELECT * FROM active_byte_multipliers
  ORDER BY expires_at ASC
`);

// ============================================================================
// Functions
// ============================================================================

/**
 * Get a user's active multiplier in a guild.
 *
 * @returns The active multiplier record, or null if user has no active multiplier
 */
export function getActiveMultiplier(guildId: string, userId: string): ActiveMultiplier | null {
  try {
    const row = getActiveMultiplierStmt.get(guildId, userId) as ActiveMultiplier | undefined;
    return row ?? null;
  } catch (err) {
    logger.error({ err, guildId, userId }, "[byteMultiplierStore] Failed to get active multiplier");
    return null;
  }
}

/**
 * Create or replace a user's active multiplier.
 *
 * Uses INSERT ... ON CONFLICT to atomically handle both new redemptions
 * and upgrades (where user replaces current multiplier with a better one).
 */
export function upsertActiveMultiplier(params: UpsertMultiplierParams): void {
  const {
    guildId,
    userId,
    multiplierRoleId,
    multiplierName,
    multiplierValue,
    expiresAt,
    tokenRarity,
    redeemedBy,
  } = params;

  try {
    upsertMultiplierStmt.run(
      guildId,
      userId,
      multiplierRoleId,
      multiplierName,
      multiplierValue,
      expiresAt,
      tokenRarity,
      redeemedBy
    );

    logger.info(
      {
        guildId,
        userId,
        multiplierName,
        multiplierValue,
        expiresAt,
        tokenRarity,
      },
      "[byteMultiplierStore] Upserted active multiplier"
    );
  } catch (err) {
    logger.error(
      { err, guildId, userId, multiplierName },
      "[byteMultiplierStore] Failed to upsert multiplier"
    );
    throw err;
  }
}

/**
 * Find and remove all expired multipliers.
 *
 * This is called by the scheduler every 60 seconds. Returns the list of
 * expired entries so the caller can remove the Discord roles.
 *
 * IMPORTANT: This function both fetches AND deletes in the same call to
 * prevent race conditions where an entry could be processed twice.
 */
export function removeExpiredMultipliers(): ExpiredMultiplier[] {
  const nowSeconds = Math.floor(Date.now() / 1000);

  try {
    // First get all expired entries
    const expired = getExpiredMultipliersStmt.all(nowSeconds) as ExpiredMultiplier[];

    if (expired.length > 0) {
      // Then delete them
      const result = deleteExpiredMultipliersStmt.run(nowSeconds);

      logger.info(
        { count: result.changes, expiredAt: nowSeconds },
        "[byteMultiplierStore] Removed expired multipliers"
      );
    }

    return expired;
  } catch (err) {
    logger.error({ err }, "[byteMultiplierStore] Failed to remove expired multipliers");
    return [];
  }
}

/**
 * Remove a specific user's multiplier (e.g., when they leave the server).
 *
 * @returns true if a row was deleted, false if user had no active multiplier
 */
export function removeUserMultiplier(guildId: string, userId: string): boolean {
  try {
    const result = removeUserMultiplierStmt.run(guildId, userId);

    if (result.changes > 0) {
      logger.info({ guildId, userId }, "[byteMultiplierStore] Removed user multiplier");
      return true;
    }

    return false;
  } catch (err) {
    logger.error({ err, guildId, userId }, "[byteMultiplierStore] Failed to remove user multiplier");
    return false;
  }
}

/**
 * Get all active multipliers across all guilds.
 * Used for debugging and admin commands.
 */
export function getAllActiveMultipliers(): ActiveMultiplier[] {
  try {
    return getAllActiveMultipliersStmt.all() as ActiveMultiplier[];
  } catch (err) {
    logger.error({ err }, "[byteMultiplierStore] Failed to get all active multipliers");
    return [];
  }
}

/**
 * Check if a user has an active multiplier that would be replaced.
 * Returns info for the confirmation UI warning.
 */
export function checkWouldReplace(
  guildId: string,
  userId: string
): { wouldReplace: boolean; current: ActiveMultiplier | null } {
  const current = getActiveMultiplier(guildId, userId);

  if (!current) {
    return { wouldReplace: false, current: null };
  }

  // Check if current is still active (not expired)
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (current.expires_at <= nowSeconds) {
    // Already expired, won't actually replace
    return { wouldReplace: false, current: null };
  }

  return { wouldReplace: true, current };
}
