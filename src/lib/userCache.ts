/**
 * Pawtropolis Tech — src/lib/userCache.ts
 * WHAT: Upserts Discord user identity data into user_cache for dashboard display.
 * WHY: The dashboard needs usernames and avatars but can't call the Discord API.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { User, GuildMember } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "./logger.js";

/** Discord epoch (ms): 2015-01-01T00:00:00.000Z */
const DISCORD_EPOCH = 1420070400000;

/** Extract account creation timestamp (ms) from a Discord snowflake ID. */
export function snowflakeToTimestamp(id: string): number {
  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
}

const UPSERT_SQL = `
  INSERT INTO user_cache (user_id, guild_id, username, global_name, display_name, avatar_hash, avatar_url, banner_url, accent_color, joined_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, guild_id) DO UPDATE SET
    username = excluded.username,
    global_name = excluded.global_name,
    display_name = excluded.display_name,
    avatar_hash = excluded.avatar_hash,
    avatar_url = excluded.avatar_url,
    banner_url = COALESCE(excluded.banner_url, banner_url),
    accent_color = COALESCE(excluded.accent_color, accent_color),
    joined_at = COALESCE(excluded.joined_at, joined_at),
    created_at = COALESCE(excluded.created_at, created_at),
    updated_at = datetime('now')
`;

/**
 * Cache a Discord user's identity for dashboard display.
 * Call this whenever we have a fresh User object (application submit, claim, etc).
 */
export function cacheUser(user: User, guildId: string, member?: GuildMember | null): void {
  try {
    const avatarUrl = member?.displayAvatarURL({ size: 128 }) ?? user.displayAvatarURL({ size: 128 });
    const displayName = member?.displayName ?? user.globalName ?? user.username;
    const bannerUrl = user.bannerURL?.({ size: 512 }) ?? null;
    const accentColor = user.accentColor ?? null;
    const joinedAt = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
    const createdAt = Math.floor(snowflakeToTimestamp(user.id) / 1000);
    db.prepare(UPSERT_SQL).run(
      user.id,
      guildId,
      user.username,
      user.globalName ?? null,
      displayName,
      user.avatar ?? null,
      avatarUrl,
      bannerUrl,
      accentColor,
      joinedAt,
      createdAt,
    );
  } catch (err) {
    logger.warn({ err, userId: user.id, guildId }, "[userCache] failed to cache user");
  }
}
