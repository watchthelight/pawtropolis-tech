// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/scheduler/dbIntegrityScheduler.ts
 * WHAT: Periodic off-process PRAGMA quick_check, every DB_INTEGRITY_INTERVAL_HOURS (default 6).
 * WHY: The check used to run inline on every 60s ops health tick. See src/lib/dbIntegrityCheck.ts.
 */

import { refreshDbIntegrity } from "../lib/dbIntegrityCheck.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

const DEFAULT_INTERVAL_HOURS = 6;
const INITIAL_DELAY_MS = 5 * 60_000;

let interval: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;

function intervalMs(): number {
  const hours = parseFloat(process.env.DB_INTEGRITY_INTERVAL_HOURS ?? "");
  const h = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_INTERVAL_HOURS;
  return Math.max(60_000, Math.floor(h * 3600_000));
}

async function tick(): Promise<void> {
  const startedAt = Date.now();
  try {
    await refreshDbIntegrity("quick");
    recordSchedulerRun("dbIntegrity", true, Date.now() - startedAt);
  } catch (err) {
    recordSchedulerRun("dbIntegrity", false, Date.now() - startedAt);
    logger.error({ err }, "[dbIntegrity:scheduler] check failed");
  }
}

export function startDbIntegrityScheduler(): void {
  if (process.env.DB_INTEGRITY_SCHEDULER_DISABLED === "1") return;
  stopDbIntegrityScheduler();
  initialTimer = setTimeout(() => {
    void tick();
  }, INITIAL_DELAY_MS);
  initialTimer.unref();
  interval = setInterval(() => {
    void tick();
  }, intervalMs());
  interval.unref();
  logger.info({ intervalMs: intervalMs() }, "[dbIntegrity:scheduler] started");
}

export function stopDbIntegrityScheduler(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
