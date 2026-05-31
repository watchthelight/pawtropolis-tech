// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/startup/schedulers.ts
 * WHAT: Boots and stops every recurring scheduler in the bot.
 * WHY: src/index.ts had eight scheduler-start blocks and a parallel
 *      eight-scheduler stop block during graceful shutdown. The two
 *      lists must stay aligned (start one, stop one). Centralizing
 *      makes that obvious and lets the wrapper handle fail-soft
 *      uniformly.
 *
 * Behavior preserved:
 *   - Each start runs under runStartupTask("<name>", ..., { level: "warn" })
 *     because every scheduler is optional.
 *   - The order of starts mirrors the previous order in index.ts.
 *   - Each stop runs unwrapped (no try/catch around stopX) — these were
 *     also unwrapped in the previous shutdown handler. If a stop throws,
 *     the gracefulShutdown outer try/catch logs it and continues.
 */

import type { Client } from "discord.js";
import { runStartupTask } from "./runStartupTask.js";

/**
 * startSchedulers: wires up every recurring background job. Each
 * scheduler is started under a fail-soft wrapper because none of them
 * is critical for command dispatch — losing the disk-space scheduler
 * doesn't stop the bot from approving applications.
 */
export async function startSchedulers(client: Client): Promise<void> {
  // Mod metrics: refresh mod_metrics table every 15 minutes
  await runStartupTask(
    "scheduler_mod_metrics",
    async () => {
      const { startModMetricsScheduler } = await import(
        "../scheduler/modMetricsScheduler.js"
      );
      startModMetricsScheduler(client);
    },
    { level: "warn" },
  );

  // Guild snapshot: writes live Discord data to SQLite every 5 minutes
  await runStartupTask(
    "scheduler_guild_snapshot",
    async () => {
      const { startGuildSnapshotScheduler } = await import(
        "../scheduler/guildSnapshotScheduler.js"
      );
      startGuildSnapshotScheduler(client);
    },
    { level: "warn" },
  );

  // Ops health: 60s health checks
  await runStartupTask(
    "scheduler_ops_health",
    async () => {
      const { startOpsHealthScheduler } = await import(
        "../scheduler/opsHealthScheduler.js"
      );
      const { setHealthClient } = await import("../features/opsHealth.js");
      setHealthClient(client);
      startOpsHealthScheduler(client);
    },
    { level: "warn" },
  );

  // Stale application alerts: every 30 minutes
  await runStartupTask(
    "scheduler_stale_apps",
    async () => {
      const { startStaleApplicationScheduler } = await import(
        "../scheduler/staleApplicationCheck.js"
      );
      startStaleApplicationScheduler(client);
    },
    { level: "warn" },
  );

  // Security audit: every 30 minutes
  await runStartupTask(
    "scheduler_security_audit",
    async () => {
      const { startSecurityAuditScheduler } = await import(
        "../scheduler/securityAuditScheduler.js"
      );
      startSecurityAuditScheduler(client);
    },
    { level: "warn" },
  );

  // Byte multiplier expiration: every 60 seconds
  await runStartupTask(
    "scheduler_byte_multiplier",
    async () => {
      const { startByteMultiplierCleanup } = await import(
        "../scheduler/byteMultiplierScheduler.js"
      );
      startByteMultiplierCleanup(client);
    },
    { level: "warn" },
  );

  // Disk space monitor
  await runStartupTask(
    "scheduler_disk_space",
    async () => {
      const { startDiskSpaceScheduler } = await import(
        "../scheduler/diskSpaceScheduler.js"
      );
      startDiskSpaceScheduler(client);
    },
    { level: "warn" },
  );

  // Event timeout: auto-end stale events after 12 hours
  await runStartupTask(
    "scheduler_event_timeout",
    async () => {
      const { startEventTimeoutScheduler } = await import(
        "../scheduler/eventTimeoutScheduler.js"
      );
      startEventTimeoutScheduler(client);
    },
    { level: "warn" },
  );

  // Badge refresh: refreshes Discord-name + role-color cache for docs badges
  await runStartupTask(
    "scheduler_badge_refresh",
    async () => {
      const { startBadgeRefreshScheduler } = await import(
        "../scheduler/badgeRefreshScheduler.js"
      );
      startBadgeRefreshScheduler(client);
      const { attachBadgeLiveListeners } = await import(
        "../features/badges/liveUpdates.js"
      );
      attachBadgeLiveListeners(client);
    },
    { level: "warn" },
  );

  // Message activity retention: daily prune of message_activity (90-day window)
  await runStartupTask(
    "scheduler_message_activity_prune",
    async () => {
      const { startMessageActivityPruneScheduler } = await import(
        "../scheduler/messageActivityPruneScheduler.js"
      );
      startMessageActivityPruneScheduler(client);
    },
    { level: "warn" },
  );
}

/**
 * stopSchedulers: tears down every scheduler started above. Called
 * from gracefulShutdown. Order is start-order so the symmetry is easy
 * to audit. Errors propagate up to the gracefulShutdown try/catch.
 */
export async function stopSchedulers(): Promise<void> {
  const { stopModMetricsScheduler } = await import(
    "../scheduler/modMetricsScheduler.js"
  );
  stopModMetricsScheduler();

  const { stopGuildSnapshotScheduler } = await import(
    "../scheduler/guildSnapshotScheduler.js"
  );
  stopGuildSnapshotScheduler();

  const { stopOpsHealthScheduler } = await import(
    "../scheduler/opsHealthScheduler.js"
  );
  stopOpsHealthScheduler();

  const { stopStaleApplicationScheduler } = await import(
    "../scheduler/staleApplicationCheck.js"
  );
  stopStaleApplicationScheduler();

  const { stopSecurityAuditScheduler } = await import(
    "../scheduler/securityAuditScheduler.js"
  );
  stopSecurityAuditScheduler();

  const { stopByteMultiplierCleanup } = await import(
    "../scheduler/byteMultiplierScheduler.js"
  );
  stopByteMultiplierCleanup();

  const { stopDiskSpaceScheduler } = await import(
    "../scheduler/diskSpaceScheduler.js"
  );
  stopDiskSpaceScheduler();

  const { stopEventTimeoutScheduler } = await import(
    "../scheduler/eventTimeoutScheduler.js"
  );
  stopEventTimeoutScheduler();

  const { stopBadgeRefreshScheduler } = await import(
    "../scheduler/badgeRefreshScheduler.js"
  );
  stopBadgeRefreshScheduler();

  const { stopMessageActivityPruneScheduler } = await import(
    "../scheduler/messageActivityPruneScheduler.js"
  );
  stopMessageActivityPruneScheduler();
}
