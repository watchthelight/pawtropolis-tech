/**
 * Pawtropolis Tech — src/scheduler/eventTimeoutScheduler.ts
 * WHAT: Auto-end movie/game events that have been running longer than 12 hours.
 * WHY: Prevents events from being left open indefinitely when staff forgets to
 *      run /event movie end or /event game end.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client } from "discord.js";
import { getActiveMovieEvent, finalizeMovieAttendance } from "../features/movieNight.js";
import {
  getActiveGameEvent,
  finalizeGameAttendance,
} from "../features/events/gameNight.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_EVENT_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

let _activeInterval: NodeJS.Timeout | null = null;

async function checkStalledEvents(client: Client): Promise<number> {
  const now = Date.now();
  let endedCount = 0;

  for (const guild of client.guilds.cache.values()) {
    // Check movie events
    const movieEvent = getActiveMovieEvent(guild.id);
    if (movieEvent && now - movieEvent.startedAt > MAX_EVENT_DURATION_MS) {
      logger.warn(
        {
          guildId: guild.id,
          eventDate: movieEvent.eventDate,
          startedAt: movieEvent.startedAt,
          runningHours: Math.round((now - movieEvent.startedAt) / 3600000),
        },
        "[eventTimeout] Auto-ending stalled movie event (>12h)"
      );
      try {
        await finalizeMovieAttendance(guild);
        endedCount++;
      } catch (err) {
        logger.error({ err, guildId: guild.id }, "[eventTimeout] Failed to auto-end movie event");
      }
    }

    // Check game events
    const gameEvent = getActiveGameEvent(guild.id);
    if (gameEvent && now - gameEvent.startedAt > MAX_EVENT_DURATION_MS) {
      logger.warn(
        {
          guildId: guild.id,
          eventDate: gameEvent.eventDate,
          startedAt: gameEvent.startedAt,
          runningHours: Math.round((now - gameEvent.startedAt) / 3600000),
        },
        "[eventTimeout] Auto-ending stalled game event (>12h)"
      );
      try {
        await finalizeGameAttendance(guild);
        endedCount++;
      } catch (err) {
        logger.error({ err, guildId: guild.id }, "[eventTimeout] Failed to auto-end game event");
      }
    }
  }

  return endedCount;
}

export function startEventTimeoutScheduler(client: Client): void {
  if (process.env.EVENT_TIMEOUT_DISABLED === "1") {
    logger.debug("[eventTimeout] scheduler disabled via env flag");
    return;
  }

  logger.info(
    { intervalMinutes: CHECK_INTERVAL_MS / 60000, maxHours: MAX_EVENT_DURATION_MS / 3600000 },
    "[eventTimeout] scheduler starting"
  );

  const interval = setInterval(async () => {
    try {
      const count = await checkStalledEvents(client);
      recordSchedulerRun("eventTimeout", true);
      if (count > 0) {
        logger.info({ count }, "[eventTimeout] Auto-ended stalled events");
      }
    } catch (err) {
      recordSchedulerRun("eventTimeout", false);
      logger.error({ err }, "[eventTimeout] Scheduler tick failed");
    }
  }, CHECK_INTERVAL_MS);

  interval.unref();
  _activeInterval = interval;
}

export function stopEventTimeoutScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[eventTimeout] scheduler stopped");
  }
}
