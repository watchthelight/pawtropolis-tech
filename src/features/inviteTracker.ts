/**
 * Pawtropolis Tech — src/features/inviteTracker.ts
 * WHAT: Tracks which invite code each new member used (growth source attribution)
 * WHY: Newsletter and insights can show WHERE growth is coming from (Disboard, direct link, etc.)
 *
 * REQUIRES:
 *  - GuildInvites intent (for inviteCreate/inviteDelete events)
 *  - MANAGE_GUILD permission (for guild.invites.fetch())
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import type { Client, Guild, GuildMember, Invite } from "discord.js";

// guild_id -> (invite_code -> uses)
const inviteCache = new Map<string, Map<string, number>>();

// Lazy-init to avoid DB access at import time (table may not exist yet)
let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  return (_upsert ??= db.prepare(`
    INSERT OR REPLACE INTO invite_usage (guild_id, user_id, invite_code, inviter_id, joined_at_s)
    VALUES (?, ?, ?, ?, ?)
  `));
}

/** Cache all invites for a guild. Call on bot ready. */
async function cacheGuildInvites(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses ?? 0])));
    logger.debug({ guildId: guild.id, invites: invites.size }, "[invite-tracker] Cached invites");
  } catch (err) {
    // Bot may lack MANAGE_GUILD permission — non-fatal
    logger.debug({ err, guildId: guild.id }, "[invite-tracker] Failed to cache invites (may lack permission)");
  }
}

/** Initialize invite cache for all guilds. Call on bot ready. */
export async function initInviteCache(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    await cacheGuildInvites(guild);
  }
}

/** Diff invites to find which one a new member used. Call from guildMemberAdd. */
export async function trackMemberInvite(member: GuildMember): Promise<void> {
  const guildId = member.guild.id;
  let usedCode: string | null = null;
  let inviterId: string | null = null;

  try {
    const newInvites = await member.guild.invites.fetch();
    const oldCache = inviteCache.get(guildId);

    if (oldCache) {
      for (const [code, invite] of newInvites) {
        const oldUses = oldCache.get(code) ?? 0;
        if ((invite.uses ?? 0) > oldUses) {
          usedCode = code;
          inviterId = invite.inviterId ?? null;
          break;
        }
      }
    }

    // Update cache with fresh data
    inviteCache.set(guildId, new Map(newInvites.map(i => [i.code, i.uses ?? 0])));
  } catch {
    // Non-critical — record with null invite
  }

  // Race condition note: if two members join near-simultaneously, both calls diff against
  // the same old cache. One join may be mis-attributed. This is inherent to Discord's invite
  // tracking approach and accepted as a known limitation.
  upsertStmt().run(guildId, member.id, usedCode, inviterId, Math.floor(Date.now() / 1000));
}

/** Update cache when an invite is created. */
export function handleInviteCreate(invite: Invite): void {
  if (!invite.guild) return;
  const cache = inviteCache.get(invite.guild.id) ?? new Map();
  cache.set(invite.code, invite.uses ?? 0);
  inviteCache.set(invite.guild.id, cache);
}

/** Update cache when an invite is deleted. */
export function handleInviteDelete(invite: Invite): void {
  if (!invite.guild) return;
  inviteCache.get(invite.guild.id)?.delete(invite.code);
}
