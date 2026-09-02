/**
 * Pawtropolis Tech — src/store/nsfwFlagsStore.ts
 * WHAT: Storage layer for NSFW avatar flags from /audit nsfw command
 * WHY: Centralize NSFW flag CRUD operations separate from bot detection flags
 * FLOWS:
 *  - upsertNsfwFlag({ guildId, userId, avatarUrl, nsfwScore, reason, flaggedBy }) → void
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

/*
 * GOTCHA: Prepared statements are created at module import time.
 * If the db connection isn't ready yet, this will explode spectacularly.
 * Make sure db is initialized before anything imports this file.
 */
const upsertNsfwFlagStmt = db.prepare(
  `INSERT INTO nsfw_flags (guild_id, user_id, avatar_url, nsfw_score, reason, flagged_by)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(guild_id, user_id) DO UPDATE SET
     avatar_url = excluded.avatar_url,
     nsfw_score = excluded.nsfw_score,
     reason = excluded.reason,
     flagged_by = excluded.flagged_by,
     flagged_at = datetime('now'),
     reviewed = 0`
);

/**
 * Upsert NSFW flag for a user's avatar.
 * "Upsert" because we only care about the latest offense per user per guild.
 * Their previous sins are overwritten, not accumulated. Small mercies.
 */
export function upsertNsfwFlag(params: {
  guildId: string;
  userId: string;
  avatarUrl: string;
  nsfwScore: number;
  reason: string;
  flaggedBy: string;
}): void {
  const { guildId, userId, avatarUrl, nsfwScore, reason, flaggedBy } = params;

  try {
    // Synchronous. No await needed. better-sqlite3 blocks the event loop
    // and we've all just accepted that this is fine, apparently.
    upsertNsfwFlagStmt.run(guildId, userId, avatarUrl, nsfwScore, reason, flaggedBy);
    logger.info(
      { guildId, userId, nsfwScore, reason },
      "[nsfwFlagsStore] Upserted NSFW flag"
    );
  } catch (err) {
    // Log it, then throw it. Let the caller decide if this is recoverable.
    // Spoiler: it probably isn't.
    logger.error({ err, guildId, userId }, "[nsfwFlagsStore] Failed to upsert NSFW flag");
    throw err;
  }
}

/**
 * Score Vision already produced for this exact avatar, from this audit's own flags or the
 * application-time scan. Avatar URLs embed the avatar hash, so a hash match means the
 * image is unchanged and another Vision call would only repeat the answer.
 */
export function findKnownAvatarScore(guildId: string, userId: string, avatarHash: string): number | null {
  const pattern = `%/${avatarHash}.%`;
  const flagged = db
    .prepare(
      "SELECT nsfw_score FROM nsfw_flags WHERE guild_id = ? AND user_id = ? AND avatar_url LIKE ? LIMIT 1"
    )
    .get(guildId, userId, pattern) as { nsfw_score: number } | undefined;
  if (flagged) return flagged.nsfw_score;
  const scanned = db
    .prepare(
      `SELECT s.nsfw_score AS score
         FROM avatar_scan s
         JOIN application a ON a.id = COALESCE(s.app_id, s.application_id)
        WHERE a.guild_id = ? AND a.user_id = ? AND s.avatar_url LIKE ? AND s.nsfw_score IS NOT NULL
        ORDER BY s.scanned_at DESC
        LIMIT 1`
    )
    .get(guildId, userId, pattern) as { score: number } | undefined;
  return scanned?.score ?? null;
}
