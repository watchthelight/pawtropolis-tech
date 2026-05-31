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
import {
  getExpiredMultipliers,
  deleteReconciledMultiplier,
  type ExpiredMultiplier,
} from "../store/byteMultiplierStore.js";
import { isPanicMode } from "../features/panicStore.js";
import { logActionPretty } from "../logging/pretty.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

// WHY 60 seconds? Fast enough to feel responsive (roles expire within a minute of their time),
// but not so aggressive that we're hammering the database and Discord API.
// Also, 60 seconds means the scheduler fires at predictable minute boundaries.
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

let _activeInterval: NodeJS.Timeout | null = null;
// Reentrancy guard: the immediate startup pass and the first interval tick (or
// any long-running tick) can overlap. Without this, two invocations could select
// and process the same not-yet-deleted rows, double-removing roles and
// double-logging byte_multiplier_expired to the audit trail. #00170
let _cleanupRunning = false;

/**
 * WHAT: Remove expired multiplier roles from Discord.
 * WHY: Users should lose their XP boost when the time is up.
 *
 * @param client - Discord.js client instance
 * @returns Number of multipliers cleaned up
 */
async function cleanupExpiredMultipliers(client: Client): Promise<number> {
  // Skip if a previous pass is still awaiting Discord REST so overlapping ticks
  // cannot both claim and process the same rows. #00170
  if (_cleanupRunning) {
    logger.debug("[byteMultiplier] Cleanup already running, skipping overlapping tick");
    return 0;
  }
  _cleanupRunning = true;
  try {
    // Fetch expired entries WITHOUT deleting. Each row is deleted only after its
    // Discord side effect is reconciled (processExpiredMultiplier returns true),
    // so an entry skipped on panic mode or a transient fetch failure is retained
    // and retried next tick instead of being orphaned. #00146
    const expired = getExpiredMultipliers();

    if (expired.length === 0) {
      logger.debug("[byteMultiplier] No expired multipliers to clean up");
      return 0;
    }

    logger.info(
      { count: expired.length },
      "[byteMultiplier] Processing expired multipliers"
    );

    // Process all expired entries in parallel — each one is two REST calls
    // (member.roles.remove + logActionPretty), and discord.js's REST manager
    // queues per route automatically. Sequential processing turned a 50-entry
    // batch into ~20s of blocking; parallel keeps it under one round-trip's
    // worth.
    const settled = await Promise.allSettled(
      expired.map((entry) => processExpiredMultiplier(client, entry))
    );

    let successCount = 0;
    let errorCount = 0;
    let retainedCount = 0;
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]!;
      const entry = expired[i]!;
      if (r.status === "fulfilled") {
        if (r.value) {
          // Reconciled: delete the authoritative row now that the side effect is done.
          deleteReconciledMultiplier(entry.guild_id, entry.user_id, entry.expires_at);
          successCount++;
        } else {
          // Retained (panic mode / transient failure): leave the row for retry.
          retainedCount++;
        }
      } else {
        // Threw before reconciling: keep the row so the next tick can retry.
        logger.error(
          { err: r.reason, guildId: entry.guild_id, userId: entry.user_id },
          "[byteMultiplier] Failed to process expired multiplier"
        );
        errorCount++;
      }
    }

    logger.info(
      { successCount, errorCount, retainedCount, total: expired.length },
      "[byteMultiplier] Cleanup batch complete"
    );

    return successCount;
  } finally {
    _cleanupRunning = false;
  }
}

/**
 * Process a single expired multiplier: remove Discord role and log.
 *
 * @returns true if the entry was reconciled and its DB row should be deleted;
 *   false if the row should be retained for a later retry (panic mode active).
 */
async function processExpiredMultiplier(
  client: Client,
  entry: ExpiredMultiplier
): Promise<boolean> {
  const guild = client.guilds.cache.get(entry.guild_id);

  if (!guild) {
    // Bot is no longer in this guild. The row is unactionable, so reclaim it.
    logger.debug(
      { guildId: entry.guild_id, userId: entry.user_id },
      "[byteMultiplier] Guild not in cache, dropping stale row"
    );
    return true;
  }

  // SECURITY: Respect panic mode - don't touch roles during emergencies
  if (isPanicMode(entry.guild_id)) {
    logger.warn(
      { guildId: entry.guild_id, userId: entry.user_id },
      "[byteMultiplier] Skipping expiry cleanup - panic mode active"
    );
    // Retain the row (return false): the role is still on the member, so we leave
    // the tracking row so a later tick can finish the removal once panic clears. #00146
    return false;
  }

  // Fetch member (they might have left the server)
  const member = await guild.members.fetch(entry.user_id).catch(() => null);

  if (!member) {
    // Member left the server; the role left with them, so reconcile the row.
    logger.debug(
      { guildId: entry.guild_id, userId: entry.user_id },
      "[byteMultiplier] Member not found, skipping role removal"
    );
    return true;
  }

  // Check if member still has the role (they might have removed it manually)
  if (!member.roles.cache.has(entry.multiplier_role_id)) {
    logger.debug(
      { guildId: entry.guild_id, userId: entry.user_id, roleId: entry.multiplier_role_id },
      "[byteMultiplier] Member no longer has role, skipping"
    );
    return true;
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

  // Log to audit trail using the dedicated action type so the card renders as
  // a gray "XP Multiplier Expired" instead of a red "Role Grant Blocked".
  await logActionPretty(guild, {
    actorId: client.user?.id ?? "system",
    subjectId: entry.user_id,
    action: "byte_multiplier_expired",
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

  return true;
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
