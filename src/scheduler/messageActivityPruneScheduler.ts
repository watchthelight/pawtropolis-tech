/**
 * Pawtropolis Tech -- src/scheduler/messageActivityPruneScheduler.ts
 * WHAT: Daily retention sweep for the message_activity table.
 * WHY: pruneOldMessages() existed but nothing ever called it, so message_activity
 *      grew unbounded (a contributor to the observed multi-GB data.db) (#00250).
 *      This wires the prune into the scheduler set so retention actually happens.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client } from "discord.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";
import { pruneOldMessages } from "../features/messageActivityLogger.js";

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const DAYS_TO_KEEP = 90;

let _activeInterval: NodeJS.Timeout | null = null;

function pruneAllGuilds(client: Client): void {
  let totalDeleted = 0;
  for (const [, guild] of client.guilds.cache) {
    try {
      totalDeleted += pruneOldMessages(guild.id, DAYS_TO_KEEP);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "[messageActivityPrune] failed to prune guild");
    }
  }
  logger.info({ totalDeleted, daysToKeep: DAYS_TO_KEEP }, "[messageActivityPrune] retention sweep complete");
}

export function startMessageActivityPruneScheduler(client: Client): void {
  logger.info({ intervalHours: PRUNE_INTERVAL_MS / 3_600_000, daysToKeep: DAYS_TO_KEEP }, "[messageActivityPrune] scheduler starting");

  // Initial sweep on startup.
  try {
    pruneAllGuilds(client);
    recordSchedulerRun("messageActivityPrune", true);
  } catch (err) {
    recordSchedulerRun("messageActivityPrune", false);
    logger.error({ err }, "[messageActivityPrune] initial sweep failed");
  }

  const interval = setInterval(() => {
    try {
      pruneAllGuilds(client);
      recordSchedulerRun("messageActivityPrune", true);
    } catch (err) {
      recordSchedulerRun("messageActivityPrune", false);
      logger.error({ err }, "[messageActivityPrune] scheduled sweep failed");
    }
  }, PRUNE_INTERVAL_MS);

  interval.unref();
  _activeInterval = interval;
}

export function stopMessageActivityPruneScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.debug("[messageActivityPrune] scheduler stopped");
  }
}
