/**
 * Pawtropolis Tech — src/features/channelCacheSync.ts
 * WHAT: Keeps channel_cache table in sync with Discord channel names/types
 * WHY: Web dashboard can resolve channel IDs to names (e.g., insights showing "#general-chat")
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import type { Guild, GuildChannel, DMChannel, NonThreadGuildBasedChannel } from "discord.js";

// Lazy-init prepared statements to avoid DB access at import time (table may not exist yet)
let _upsert: ReturnType<typeof db.prepare> | null = null;
let _delete: ReturnType<typeof db.prepare> | null = null;

function upsertStmt() {
  return (_upsert ??= db.prepare(`
    INSERT INTO channel_cache (guild_id, channel_id, name, type, parent_id, updated_at_s)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, channel_id) DO UPDATE SET
      name = excluded.name, type = excluded.type,
      parent_id = excluded.parent_id, updated_at_s = excluded.updated_at_s
  `));
}

function deleteStmt() {
  return (_delete ??= db.prepare(
    'DELETE FROM channel_cache WHERE guild_id = ? AND channel_id = ?'
  ));
}

/** Full sync of all channels for a guild. Call on bot ready. */
export function syncAllChannels(guild: Guild): void {
  try {
    const stmt = upsertStmt();
    const nowS = Math.floor(Date.now() / 1000);
    const tx = db.transaction(() => {
      for (const [, ch] of guild.channels.cache) {
        stmt.run(guild.id, ch.id, ch.name, ch.type, ch.parentId ?? null, nowS);
      }
    });
    tx();
    logger.debug({ guildId: guild.id, channels: guild.channels.cache.size }, "[channel-cache] Full sync complete");
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[channel-cache] Full sync failed");
  }
}

/** Upsert a single channel. Call on channelCreate/channelUpdate. */
export function syncChannel(channel: GuildChannel | NonThreadGuildBasedChannel): void {
  if (!channel.guild) return;
  try {
    upsertStmt().run(
      channel.guild.id, channel.id, channel.name, channel.type,
      channel.parentId ?? null, Math.floor(Date.now() / 1000)
    );
  } catch (err) {
    logger.debug({ err, channelId: channel.id }, "[channel-cache] Upsert failed");
  }
}

/** Remove a channel from cache. Call on channelDelete. */
export function removeChannel(channel: GuildChannel | DMChannel | NonThreadGuildBasedChannel): void {
  if (!("guild" in channel) || !channel.guild) return;
  try {
    deleteStmt().run(channel.guild.id, channel.id);
  } catch (err) {
    logger.debug({ err, channelId: channel.id }, "[channel-cache] Delete failed");
  }
}
