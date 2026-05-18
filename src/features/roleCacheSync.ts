/**
 * Pawtropolis Tech — src/features/roleCacheSync.ts
 * WHAT: Keeps role_cache table in sync with Discord role names/colors.
 * WHY: Web dashboard's welcome editor resolves <@&id> mentions to chips without
 *      hitting the Discord API; mirror of channelCacheSync.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import type { Guild, Role } from "discord.js";

let _upsert: ReturnType<typeof db.prepare> | null = null;
let _delete: ReturnType<typeof db.prepare> | null = null;

function upsertStmt() {
  return (_upsert ??= db.prepare(`
    INSERT INTO role_cache (guild_id, role_id, name, color, position, mentionable, managed, updated_at_s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, role_id) DO UPDATE SET
      name = excluded.name, color = excluded.color, position = excluded.position,
      mentionable = excluded.mentionable, managed = excluded.managed,
      updated_at_s = excluded.updated_at_s
  `));
}

function deleteStmt() {
  return (_delete ??= db.prepare(
    'DELETE FROM role_cache WHERE guild_id = ? AND role_id = ?'
  ));
}

/** Full sync of all roles for a guild. Call on bot ready. */
export function syncAllRoles(guild: Guild): void {
  try {
    const stmt = upsertStmt();
    const nowS = Math.floor(Date.now() / 1000);
    const tx = db.transaction(() => {
      for (const [, role] of guild.roles.cache) {
        stmt.run(
          guild.id, role.id, role.name, role.color, role.position,
          role.mentionable ? 1 : 0, role.managed ? 1 : 0, nowS
        );
      }
    });
    tx();
    logger.debug({ guildId: guild.id, roles: guild.roles.cache.size }, "[role-cache] Full sync complete");
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[role-cache] Full sync failed");
  }
}

/** Upsert a single role. Call on roleCreate/roleUpdate. */
export function syncRole(role: Role): void {
  if (!role.guild) return;
  try {
    upsertStmt().run(
      role.guild.id, role.id, role.name, role.color, role.position,
      role.mentionable ? 1 : 0, role.managed ? 1 : 0,
      Math.floor(Date.now() / 1000)
    );
  } catch (err) {
    logger.debug({ err, roleId: role.id }, "[role-cache] Upsert failed");
  }
}

/** Remove a role from cache. Call on roleDelete. */
export function removeRole(role: Role): void {
  if (!role.guild) return;
  try {
    deleteStmt().run(role.guild.id, role.id);
  } catch (err) {
    logger.debug({ err, roleId: role.id }, "[role-cache] Delete failed");
  }
}
