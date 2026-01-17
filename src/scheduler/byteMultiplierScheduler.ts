/**
 * Pawtropolis Tech — src/scheduler/byteMultiplierScheduler.ts
 * WHAT: Periodic scheduler for removing expired XP multiplier roles
 * WHY: Automatically clean up byte token multipliers without staff intervention
 * FLOWS:
 *  - Every 60 seconds → check for expired multipliers → remove Discord roles → log
 *  - Respects panic mode (skips guilds in panic)
 *  - Records scheduler health metrics
 * DOCS:
 *  - setInterval: https://nodejs.org/api/timers.html#setinterval
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client } from "discord.js";
import { removeExpiredMultipliers, type ExpiredMultiplier } from "../store/byteMultiplierStore.js";
import { isPanicMode } from "../features/panicStore.js";
import { logActionPretty } from "../logging/pretty.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

// WHY 60 seconds? Fast enough to feel responsive (roles expire within a minute of their time),
// but not so aggressive that we're hammering the database and Discord API.
// Also, 60 seconds means the scheduler fires at predictable minute boundaries.
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

let _activeInterval: NodeJS.Timeout | null = null;

/**
 * WHAT: Remove expired multiplier roles from Discord.
 * WHY: Users should lose their XP boost when the time is up.
 *
 * @param client - Discord.js client instance
 * @returns Number of multipliers cleaned up
 */
async function cleanupExpiredMultipliers(client: Client): Promise<number> {
  // Get all expired entries from database (also deletes them)
  const expired = removeExpiredMultipliers();

  if (expired.length === 0) {
    logger.debug("[byteMultiplier] No expired multipliers to clean up");
    return 0;
  }

  logger.info(
    { count: expired.length },
    "[byteMultiplier] Processing expired multipliers"
  );

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const entry of expired) {
    try {
      await processExpiredMultiplier(client, entry);
      successCount++;
    } catch (err) {
      // Log but don't throw - we want to continue processing other entries
      // The database entry is already deleted, so we won't retry this one.
      // This is intentional: if role removal fails, we'd rather lose the role
      // tracking than have a user keep their multiplier forever.
      logger.error(
        { err, guildId: entry.guild_id, userId: entry.user_id },
        "[byteMultiplier] Failed to process expired multiplier"
      );
      errorCount++;
    }
  }

  logger.info(
    { successCount, skipCount, errorCount, total: expired.length },
    "[byteMultiplier] Cleanup batch complete"
  );

  return successCount;
}

/**
 * Process a single expired multiplier: remove Discord role and log.
 */
async function processExpiredMultiplier(
  client: Client,
  entry: ExpiredMultiplier
): Promise<void> {
  const guild = client.guilds.cache.get(entry.guild_id);

  if (!guild) {
    // Bot is no longer in this guild, nothing to do
    logger.debug(
      { guildId: entry.guild_id, userId: entry.user_id },
      "[byteMultiplier] Guild not in cache, skipping"
    );
    return;
  }

  // SECURITY: Respect panic mode - don't touch roles during emergencies
  if (isPanicMode(entry.guild_id)) {
    logger.warn(
      { guildId: entry.guild_id, userId: entry.user_id },
      "[byteMultiplier] Skipping expiry cleanup - panic mode active"
    );
    // NOTE: We've already deleted the DB entry. When panic mode is disabled,
    // staff will need to manually remove the role. This is acceptable since
    // panic mode is rare and implies something is very wrong.
    return;
  }

  // Fetch member (they might have left the server)
  const member = await guild.members.fetch(entry.user_id).catch(() => null);

  if (!member) {
    logger.debug(
      { guildId: entry.guild_id, userId: entry.user_id },
      "[byteMultiplier] Member not found, skipping role removal"
    );
    return;
  }

  // Check if member still has the role (they might have removed it manually)
  if (!member.roles.cache.has(entry.multiplier_role_id)) {
    logger.debug(
      { guildId: entry.guild_id, userId: entry.user_id, roleId: entry.multiplier_role_id },
      "[byteMultiplier] Member no longer has role, skipping"
    );
    return;
  }

  // Remove the multiplier role
  await member.roles.remove(
    entry.multiplier_role_id,
    `Byte multiplier expired (${entry.token_rarity} token)`
  );

  logger.info(
    {
      guildId: entry.guild_id,
      userId: entry.user_id,
      multiplierName: entry.multiplier_name,
      tokenRarity: entry.token_rarity,
    },
    "[byteMultiplier] Removed expired multiplier role"
  );

  // Log to audit trail
  // NOTE: Using "role_grant" action type with negative context since we don't have
  // a dedicated "byte_multiplier_expired" type yet. The action type can be updated
  // once it's added to pretty.ts.
  await logActionPretty(guild, {
    actorId: client.user?.id ?? "system",
    subjectId: entry.user_id,
    action: "role_grant_blocked", // Will update to "byte_multiplier_expired" once added
    reason: `${entry.multiplier_name} expired (${entry.token_rarity} byte token)`,
    meta: {
      multiplierName: entry.multiplier_name,
      tokenRarity: entry.token_rarity,
      roleId: entry.multiplier_role_id,
      expiredAt: entry.expires_at,
    },
  }).catch((err) => {
    // Don't fail the whole operation if logging fails
    logger.warn({ err, guildId: entry.guild_id }, "[byteMultiplier] Failed to log expiration");
  });
}

/**
 * WHAT: Start periodic multiplier cleanup scheduler.
 * WHY: Automatically remove expired XP boost roles.
 *
 * @param client - Discord.js client instance
 *
 * @example
 * // In src/index.ts ClientReady event:
 * import { startByteMultiplierCleanup } from './scheduler/byteMultiplierScheduler.js';
 * startByteMultiplierCleanup(client);
 *
 * // Graceful shutdown:
 * import { stopByteMultiplierCleanup } from './scheduler/byteMultiplierScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopByteMultiplierCleanup();
 * });
 */
export function startByteMultiplierCleanup(client: Client): void {
  // Opt-out for tests
  if (process.env.BYTE_SCHEDULER_DISABLED === "1") {
    logger.debug("[byteMultiplier] scheduler disabled via env flag");
    return;
  }

  logger.info(
    { intervalSeconds: CLEANUP_INTERVAL_MS / 1000 },
    "[byteMultiplier] scheduler starting"
  );

  // Run initial cleanup immediately on startup
  // This catches any multipliers that expired while the bot was offline
  cleanupExpiredMultipliers(client)
    .then((count) => {
      recordSchedulerRun("byteMultiplier", true);
      if (count > 0) {
        logger.info({ count }, "[byteMultiplier] Initial cleanup complete");
      }
    })
    .catch((err) => {
      recordSchedulerRun("byteMultiplier", false);
      logger.error({ err }, "[byteMultiplier] Initial cleanup failed");
    });

  // Set up periodic cleanup
  const interval = setInterval(async () => {
    try {
      await cleanupExpiredMultipliers(client);
      recordSchedulerRun("byteMultiplier", true);
    } catch (err) {
      recordSchedulerRun("byteMultiplier", false);
      logger.error({ err }, "[byteMultiplier] Scheduled cleanup failed");
    }
  }, CLEANUP_INTERVAL_MS);

  // Prevent interval from keeping process alive during shutdown
  interval.unref();

  _activeInterval = interval;
}

/**
 * WHAT: Stop the multiplier cleanup scheduler.
 * WHY: Clean shutdown during bot termination.
 *
 * @example
 * import { stopByteMultiplierCleanup } from './scheduler/byteMultiplierScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopByteMultiplierCleanup();
 * });
 */
export function stopByteMultiplierCleanup(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[byteMultiplier] scheduler stopped");
  }
}
