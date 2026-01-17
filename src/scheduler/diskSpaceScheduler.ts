/**
 * Pawtropolis Tech — src/scheduler/diskSpaceScheduler.ts
 * WHAT: Periodic scheduler for monitoring server disk space
 * WHY: Alert server dev before disk fills up and causes outages (like migration failures)
 * FLOWS:
 *  - Every N minutes (default 30) → checkDiskSpace() → alert if above threshold
 *  - Warning at 80% usage, critical at 90%
 *  - Pings bot_dev_role on critical alerts
 * DOCS:
 *  - fs.statfs: https://nodejs.org/api/fs.html#fsstatfspath-options-callback
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import * as fs from "node:fs/promises";
import type { Client, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";
import { getLoggingChannelId } from "../config/loggingStore.js";
import { getConfig } from "../lib/config.js";

// Check every 30 minutes - disk space doesn't change that fast
const DEFAULT_INTERVAL_MINUTES = 30;

// Thresholds for alerts
const WARNING_THRESHOLD_PERCENT = 80;
const CRITICAL_THRESHOLD_PERCENT = 90;

// Cooldown to prevent spamming alerts (4 hours)
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

// Module-level state
let _activeInterval: NodeJS.Timeout | null = null;
let _lastAlertTime: number = 0;
let _lastAlertLevel: "warning" | "critical" | null = null;

interface DiskStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

/**
 * WHAT: Get disk usage stats for the root filesystem.
 * WHY: Need to know how full the disk is to alert before problems occur.
 */
async function getDiskStats(): Promise<DiskStats> {
  // Check the root filesystem where the bot data lives
  const stats = await fs.statfs("/");

  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bfree * stats.bsize;
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = Math.round((usedBytes / totalBytes) * 100);

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent,
  };
}

/**
 * WHAT: Format bytes into human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(bytes / 1024).toFixed(1)}KB`;
}

/**
 * WHAT: Check disk space and send alert if needed.
 * WHY: Proactively notify dev before disk fills up.
 */
async function checkDiskSpace(client: Client): Promise<void> {
  const guildId = env.GUILD_ID;
  if (!guildId) {
    logger.warn("[diskspace:scheduler] GUILD_ID not configured, skipping check");
    return;
  }

  const stats = await getDiskStats();

  logger.debug(
    {
      usedPercent: stats.usedPercent,
      freeBytes: stats.freeBytes,
      totalBytes: stats.totalBytes,
    },
    "[diskspace:scheduler] disk check completed"
  );

  // Determine alert level
  let alertLevel: "warning" | "critical" | null = null;
  if (stats.usedPercent >= CRITICAL_THRESHOLD_PERCENT) {
    alertLevel = "critical";
  } else if (stats.usedPercent >= WARNING_THRESHOLD_PERCENT) {
    alertLevel = "warning";
  }

  // No alert needed
  if (!alertLevel) {
    // Reset cooldown state when disk is healthy
    _lastAlertLevel = null;
    return;
  }

  // Check cooldown - only alert if:
  // 1. We haven't alerted recently, OR
  // 2. The situation got worse (warning -> critical)
  const now = Date.now();
  const timeSinceLastAlert = now - _lastAlertTime;
  const escalated = _lastAlertLevel === "warning" && alertLevel === "critical";

  if (timeSinceLastAlert < ALERT_COOLDOWN_MS && !escalated) {
    logger.debug(
      { alertLevel, timeSinceLastAlert, cooldown: ALERT_COOLDOWN_MS },
      "[diskspace:scheduler] skipping alert (cooldown)"
    );
    return;
  }

  // Send alert
  await sendDiskSpaceAlert(client, guildId, stats, alertLevel);
  _lastAlertTime = now;
  _lastAlertLevel = alertLevel;
}

/**
 * WHAT: Send disk space alert to logging channel.
 * WHY: Notify the dev so they can clean up before outages occur.
 */
async function sendDiskSpaceAlert(
  client: Client,
  guildId: string,
  stats: DiskStats,
  level: "warning" | "critical"
): Promise<void> {
  const loggingChannelId = getLoggingChannelId(guildId);
  if (!loggingChannelId) {
    logger.warn("[diskspace:scheduler] No logging channel configured, can't send alert");
    return;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    logger.warn({ guildId }, "[diskspace:scheduler] Guild not found");
    return;
  }

  const channel = await guild.channels.fetch(loggingChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    logger.warn({ loggingChannelId }, "[diskspace:scheduler] Logging channel not found or not text-based");
    return;
  }

  const config = getConfig(guildId);
  const botDevRoleId = config?.bot_dev_role_id;

  const isCritical = level === "critical";
  const color = isCritical ? 0xff0000 : 0xffa500; // Red for critical, orange for warning
  const emoji = isCritical ? "🚨" : "⚠️";

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Disk Space ${level.charAt(0).toUpperCase() + level.slice(1)}`)
    .setColor(color)
    .setDescription(
      isCritical
        ? "Server disk is critically full. Immediate action required to prevent outages."
        : "Server disk is filling up. Consider cleaning up old files."
    )
    .addFields(
      { name: "Usage", value: `${stats.usedPercent}%`, inline: true },
      { name: "Free Space", value: formatBytes(stats.freeBytes), inline: true },
      { name: "Total", value: formatBytes(stats.totalBytes), inline: true }
    )
    .addFields({
      name: "Suggested Actions",
      value: [
        "• Delete old database backups: `ls -la data/*.backup*`",
        "• Flush PM2 logs: `pm2 flush`",
        "• Clean journal: `sudo journalctl --vacuum-time=3d`",
        "• Clean apt cache: `sudo apt-get clean`",
      ].join("\n"),
    })
    .setTimestamp()
    .setFooter({ text: "Disk Space Monitor" });

  // Ping bot_dev_role on critical alerts
  const content = isCritical && botDevRoleId ? `<@&${botDevRoleId}>` : undefined;

  await (channel as TextChannel).send({ content, embeds: [embed] });

  logger.info(
    {
      level,
      usedPercent: stats.usedPercent,
      freeBytes: stats.freeBytes,
      pingedRole: isCritical && botDevRoleId ? botDevRoleId : null,
    },
    "[diskspace:scheduler] Disk space alert sent"
  );
}

/**
 * WHAT: Start periodic disk space check scheduler.
 * WHY: Automatically monitor disk usage and alert before problems occur.
 *
 * @param client - Discord.js client instance
 */
export function startDiskSpaceScheduler(client: Client): void {
  // Opt-out for tests
  if (process.env.DISK_SPACE_SCHEDULER_DISABLED === "1") {
    logger.debug("[diskspace:scheduler] scheduler disabled via env flag");
    return;
  }

  const intervalMinutes =
    parseInt(process.env.DISK_SPACE_CHECK_INTERVAL_MINUTES || "", 10) || DEFAULT_INTERVAL_MINUTES;
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info(
    { intervalMinutes },
    "[diskspace:scheduler] starting disk space scheduler"
  );

  // Run initial check after a short delay
  setTimeout(async () => {
    try {
      await checkDiskSpace(client);
      recordSchedulerRun("diskSpace", true);
    } catch (err: any) {
      recordSchedulerRun("diskSpace", false);
      logger.error({ err: err.message }, "[diskspace:scheduler] initial check failed");
    }
  }, 15000); // 15s delay

  // Set up periodic check
  const interval = setInterval(async () => {
    try {
      await checkDiskSpace(client);
      recordSchedulerRun("diskSpace", true);
    } catch (err: any) {
      recordSchedulerRun("diskSpace", false);
      logger.error({ err: err.message }, "[diskspace:scheduler] scheduled check failed");
    }
  }, intervalMs);

  // unref() allows process to exit cleanly
  interval.unref();

  _activeInterval = interval;
}

/**
 * WHAT: Stop the disk space scheduler.
 * WHY: Clean shutdown during bot termination.
 */
export function stopDiskSpaceScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[diskspace:scheduler] scheduler stopped");
  }
}
