/**
 * Pawtropolis Tech — src/scheduler/guildSnapshotScheduler.ts
 * WHAT: Periodic writer for guild_snapshot (every 5 min) + guild_snapshot_log (daily)
 * WHY: Web dashboard reads live guild metrics from SQLite without Discord API access
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client, Guild } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ONLINE_FETCH_INTERVAL = 6; // fetch online count every Nth snapshot (= every 30 min)

let _activeInterval: NodeJS.Timeout | null = null;
let _snapshotCount = 0;

// Lazy-init prepared statements to avoid DB access at import time (table may not exist yet)
let _upsertSnapshot: ReturnType<typeof db.prepare> | null = null;
let _upsertDailyLog: ReturnType<typeof db.prepare> | null = null;

function upsertSnapshotStmt() {
  return (_upsertSnapshot ??= db.prepare(`
    INSERT INTO guild_snapshot (guild_id, member_count, online_count, boost_count, boost_tier, channel_count, role_count, voice_users_now, updated_at_s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      member_count = excluded.member_count,
      online_count = COALESCE(excluded.online_count, guild_snapshot.online_count),
      boost_count = excluded.boost_count,
      boost_tier = excluded.boost_tier,
      channel_count = excluded.channel_count,
      role_count = excluded.role_count,
      voice_users_now = excluded.voice_users_now,
      updated_at_s = excluded.updated_at_s
  `));
}

function upsertDailyLogStmt() {
  return (_upsertDailyLog ??= db.prepare(`
    INSERT INTO guild_snapshot_log (guild_id, date, member_count, online_count, boost_count, boost_tier, voice_users_now)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, date) DO UPDATE SET
      member_count = excluded.member_count,
      online_count = COALESCE(excluded.online_count, guild_snapshot_log.online_count),
      boost_count = excluded.boost_count,
      boost_tier = excluded.boost_tier,
      voice_users_now = excluded.voice_users_now
  `));
}

async function writeGuildSnapshot(guild: Guild, fetchOnline: boolean): Promise<void> {
  const nowS = Math.floor(Date.now() / 1000);

  // Only fetch online count periodically (REST API call) — gateway cache has everything else
  let onlineCount: number | null = null;
  if (fetchOnline) {
    try {
      const fetched = await guild.fetch();
      onlineCount = fetched.approximatePresenceCount ?? null;
    } catch {
      // Non-critical — leave null, COALESCE in SQL preserves previous value
    }
  }

  const voiceUsersNow = guild.voiceStates.cache.filter(vs => vs.channelId !== null).size;

  upsertSnapshotStmt().run(
    guild.id,
    guild.memberCount,
    onlineCount,
    guild.premiumSubscriptionCount ?? 0,
    guild.premiumTier,
    guild.channels.cache.size,
    guild.roles.cache.size,
    voiceUsersNow,
    nowS
  );

  // Daily log — one entry per day, updated throughout the day
  const today = new Date().toISOString().slice(0, 10);
  upsertDailyLogStmt().run(
    guild.id,
    today,
    guild.memberCount,
    onlineCount,
    guild.premiumSubscriptionCount ?? 0,
    guild.premiumTier,
    voiceUsersNow
  );
}

async function refreshAllSnapshots(client: Client, forceOnline = false): Promise<void> {
  _snapshotCount++;
  const fetchOnline = forceOnline || _snapshotCount % ONLINE_FETCH_INTERVAL === 0;

  for (const [, guild] of client.guilds.cache) {
    try {
      await writeGuildSnapshot(guild, fetchOnline);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "[snapshot] Failed to write guild snapshot");
    }
  }
}

export function startGuildSnapshotScheduler(client: Client): void {
  logger.info({ intervalMinutes: SNAPSHOT_INTERVAL_MS / 60000 }, "[snapshot] scheduler starting");

  // Initial snapshot on startup — always fetch online count
  refreshAllSnapshots(client, true)
    .then(() => recordSchedulerRun("guildSnapshot", true))
    .catch((err) => {
      recordSchedulerRun("guildSnapshot", false);
      logger.error({ err }, "[snapshot] initial snapshot failed");
    });

  const interval = setInterval(async () => {
    try {
      await refreshAllSnapshots(client);
      recordSchedulerRun("guildSnapshot", true);
    } catch (err) {
      recordSchedulerRun("guildSnapshot", false);
      logger.error({ err }, "[snapshot] scheduled snapshot failed");
    }
  }, SNAPSHOT_INTERVAL_MS);

  interval.unref();
  _activeInterval = interval;
}

export function stopGuildSnapshotScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.debug("[snapshot] scheduler stopped");
  }
}
