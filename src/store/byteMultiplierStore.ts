/**
 * Pawtropolis Tech — src/store/byteMultiplierStore.ts
 * WHAT: Storage layer for tracking active byte token multipliers
 * WHY: Enable automatic expiration of XP multiplier roles without staff intervention
 * FLOWS:
 *  - getActiveMultiplier(guildId, userId) → ActiveMultiplier | null
 *  - upsertActiveMultiplier(data) → void (creates or replaces)
 *  - getExpiredMultipliers() → ExpiredMultiplier[] (for scheduler; SELECT only)
 *  - deleteReconciledMultiplier(guildId, userId, expiresAt) → void (per-row, post-side-effect)
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
    -- Longest-wins: a stray or weaker write must never SHORTEN an active window
    -- (e.g. redeeming an epic while a longer legendary window is live). #00076
    expires_at = MAX(excluded.expires_at, active_byte_multipliers.expires_at),
    token_rarity = excluded.token_rarity,
    redeemed_by = excluded.redeemed_by,
    created_at = strftime('%s', 'now')
`);

// WHY SELECT before DELETE? We need the full row data to remove the role in Discord.
// We deliberately do NOT delete in the same call: the scheduler deletes each row
// only after the Discord side effect is reconciled, so an entry skipped due to
// panic mode or a transient fetch failure survives to be retried. #00146
const getExpiredMultipliersStmt = db.prepare(`
  SELECT guild_id, user_id, multiplier_role_id, multiplier_name, token_rarity, expires_at
  FROM active_byte_multipliers
  WHERE expires_at <= ?
`);

// Per-row reconciled delete. Guarded by expires_at so a row renewed (longer-wins
// upsert) between fetch and delete is NOT clobbered. #00146
const deleteReconciledMultiplierStmt = db.prepare(`
  DELETE FROM active_byte_multipliers
  WHERE guild_id = ? AND user_id = ? AND expires_at = ?
`);

const removeUserMultiplierStmt = db.prepare(`
  DELETE FROM active_byte_multipliers
  WHERE guild_id = ? AND user_id = ?
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
 * Fetch all currently-expired multipliers WITHOUT deleting them.
 *
 * Called by the scheduler every 60 seconds. The scheduler removes the Discord
 * role per entry and then calls deleteReconciledMultiplier() for that entry, so
 * a row whose side effect could not be applied (panic mode, transient fetch
 * failure) stays in the table and is retried on the next tick. #00146
 */
export function getExpiredMultipliers(): ExpiredMultiplier[] {
  const nowSeconds = Math.floor(Date.now() / 1000);

  try {
    return getExpiredMultipliersStmt.all(nowSeconds) as ExpiredMultiplier[];
  } catch (err) {
    logger.error({ err }, "[byteMultiplierStore] Failed to fetch expired multipliers");
    return [];
  }
}

/**
 * Delete a single expired multiplier after its Discord role removal has been
 * reconciled. The expires_at guard means a row renewed by a longer-wins upsert
 * between fetch and delete is left intact. #00146
 */
export function deleteReconciledMultiplier(
  guildId: string,
  userId: string,
  expiresAt: number
): void {
  try {
    deleteReconciledMultiplierStmt.run(guildId, userId, expiresAt);
  } catch (err) {
    logger.error(
      { err, guildId, userId, expiresAt },
      "[byteMultiplierStore] Failed to delete reconciled multiplier"
    );
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
