/**
 * Pawtropolis Tech — src/lib/userCache.ts
 * WHAT: Upserts Discord user identity data into user_cache for dashboard display.
 * WHY: The dashboard needs usernames and avatars but can't call the Discord API.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { User, GuildMember } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "./logger.js";

const UPSERT_SQL = `
  INSERT INTO user_cache (user_id, guild_id, username, global_name, display_name, avatar_hash, avatar_url, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, guild_id) DO UPDATE SET
    username = excluded.username,
    global_name = excluded.global_name,
    display_name = excluded.display_name,
    avatar_hash = excluded.avatar_hash,
    avatar_url = excluded.avatar_url,
    updated_at = datetime('now')
`;

/**
 * Cache a Discord user's identity for dashboard display.
 * Call this whenever we have a fresh User object (application submit, claim, etc).
 */
export function cacheUser(user: User, guildId: string, member?: GuildMember | null): void {
  try {
    const avatarUrl = user.displayAvatarURL({ size: 128 });
    const displayName = member?.displayName ?? user.globalName ?? user.username;
    db.prepare(UPSERT_SQL).run(
      user.id,
      guildId,
      user.username,
      user.globalName ?? null,
      displayName,
      user.avatar ?? null,
      avatarUrl,
    );
  } catch (err) {
    logger.warn({ err, userId: user.id, guildId }, "[userCache] failed to cache user");
  }
}
