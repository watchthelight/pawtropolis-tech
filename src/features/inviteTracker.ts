/**
 * Pawtropolis Tech — src/features/inviteTracker.ts
 * WHAT: Tracks which invite code each new member used (growth source attribution)
 * WHY: Review cards show WHERE growth is coming from and WHO invited each applicant
 *
 * REQUIRES:
 *  - GuildInvites intent (for inviteCreate/inviteDelete events)
 *  - MANAGE_GUILD permission (for guild.invites.fetch())
 *
 * PERSISTENCE: invite_snapshot table stores the last-known uses count per code,
 * so the diff-based tracking survives bot restarts without data loss.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import type { Client, Guild, GuildMember, Invite } from "discord.js";

// guild_id -> (invite_code -> uses)
const inviteCache = new Map<string, Map<string, number>>();
// guild_id -> vanity URL uses count (tracked separately since vanity URLs aren't in guild.invites)
const vanityCache = new Map<string, number>();

// ===== Lazy-init prepared statements =====

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  return (_upsert ??= db.prepare(`
    INSERT OR REPLACE INTO invite_usage (guild_id, user_id, invite_code, inviter_id, joined_at_s)
    VALUES (?, ?, ?, ?, ?)
  `));
}

let _snapshotUpsert: ReturnType<typeof db.prepare> | null = null;
function snapshotUpsertStmt() {
  return (_snapshotUpsert ??= db.prepare(`
    INSERT OR REPLACE INTO invite_snapshot (guild_id, invite_code, uses, inviter_id, updated_at_s)
    VALUES (?, ?, ?, ?, ?)
  `));
}

let _snapshotLoad: ReturnType<typeof db.prepare> | null = null;
function snapshotLoadStmt() {
  return (_snapshotLoad ??= db.prepare(`
    SELECT invite_code, uses FROM invite_snapshot WHERE guild_id = ?
  `));
}

let _snapshotCleanup: ReturnType<typeof db.prepare> | null = null;
function snapshotCleanupStmt() {
  return (_snapshotCleanup ??= db.prepare(`
    DELETE FROM invite_snapshot WHERE guild_id = ? AND invite_code = ?
  `));
}

// ===== Cache initialization =====

/** Load persisted snapshot from DB as fallback baseline. */
function loadSnapshotFromDb(guildId: string): Map<string, number> {
  try {
    const rows = snapshotLoadStmt().all(guildId) as Array<{ invite_code: string; uses: number }>;
    return new Map(rows.map(r => [r.invite_code, r.uses]));
  } catch {
    return new Map();
  }
}

/** Persist current invite cache to DB for restart resilience. */
function persistSnapshot(guildId: string, invites: Map<string, { uses: number; inviterId: string | null }>): void {
  const now = Math.floor(Date.now() / 1000);
  const upsert = snapshotUpsertStmt();
  const tx = db.transaction(() => {
    for (const [code, data] of invites) {
      upsert.run(guildId, code, data.uses, data.inviterId, now);
    }
  });
  try {
    tx();
  } catch (err) {
    logger.debug({ err, guildId }, "[invite-tracker] Failed to persist snapshot");
  }
}

/** Cache all invites for a guild. Call on bot ready. */
async function cacheGuildInvites(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    const cacheMap = new Map(invites.map(i => [i.code, i.uses ?? 0]));
    inviteCache.set(guild.id, cacheMap);

    // Persist to DB so next restart has a baseline
    const fullData = new Map(invites.map(i => [i.code, { uses: i.uses ?? 0, inviterId: i.inviterId ?? null }]));
    persistSnapshot(guild.id, fullData);

    logger.debug({ guildId: guild.id, invites: invites.size }, "[invite-tracker] Cached invites");
  } catch (err) {
    // Bot may lack MANAGE_GUILD permission — fall back to DB snapshot
    logger.debug({ err, guildId: guild.id }, "[invite-tracker] Failed to fetch invites, loading DB snapshot");
    const dbSnapshot = loadSnapshotFromDb(guild.id);
    if (dbSnapshot.size > 0) {
      inviteCache.set(guild.id, dbSnapshot);
      logger.debug({ guildId: guild.id, invites: dbSnapshot.size }, "[invite-tracker] Loaded snapshot from DB");
    }
  }

  // Cache vanity URL uses separately (not included in guild.invites.fetch())
  if (guild.vanityURLCode) {
    try {
      const vanity = await guild.fetchVanityData();
      vanityCache.set(guild.id, vanity.uses);
    } catch (err) {
      logger.warn({ err, guildId: guild.id, vanityCode: guild.vanityURLCode }, "[invite-tracker] Failed to cache vanity URL data (MANAGE_GUILD required)");
    }
  }
}

/** Initialize invite cache for all guilds. Call on bot ready. */
export async function initInviteCache(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    await cacheGuildInvites(guild);
  }
}

// ===== Tracking =====

// Serialize invite tracking so simultaneous joins diff against an updated cache.
// Without this, two concurrent guildMemberAdd handlers both compare against the
// same stale cache, and a Discovery join can be mis-attributed to whichever
// invite happened to gain a use from the other member.
let trackingQueue: Promise<void> = Promise.resolve();

/** Diff invites to find which one a new member used. Call from guildMemberAdd. */
export async function trackMemberInvite(member: GuildMember): Promise<void> {
  trackingQueue = trackingQueue.then(() => trackMemberInviteImpl(member)).catch((err) => { logger.warn({ err }, "[invite-tracker] trackMemberInvite failed"); });
  return trackingQueue;
}

async function trackMemberInviteImpl(member: GuildMember): Promise<void> {
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

      // Check for deleted invites (single-use invites disappear after use)
      if (!usedCode) {
        for (const [code] of oldCache) {
          if (!newInvites.has(code)) {
            // This invite was deleted — likely a single-use invite that was consumed
            usedCode = code;
            // Look up inviter from snapshot
            try {
              const snap = db.prepare(
                `SELECT inviter_id FROM invite_snapshot WHERE guild_id = ? AND invite_code = ?`
              ).get(guildId, code) as { inviter_id: string | null } | undefined;
              inviterId = snap?.inviter_id ?? null;
            } catch { /* non-critical */ }
            // Clean up the deleted invite from snapshot
            try { snapshotCleanupStmt().run(guildId, code); } catch { /* non-critical */ }
            break;
          }
        }
      }
    }

    // Update cache with fresh data and persist
    const cacheMap = new Map(newInvites.map(i => [i.code, i.uses ?? 0]));
    inviteCache.set(guildId, cacheMap);
    const fullData = new Map(newInvites.map(i => [i.code, { uses: i.uses ?? 0, inviterId: i.inviterId ?? null }]));
    persistSnapshot(guildId, fullData);

    // Vanity URL fallback: if no regular invite matched and guild has a vanity URL,
    // check if its uses count increased. Vanity URLs aren't in guild.invites.fetch().
    if (!usedCode && member.guild.vanityURLCode) {
      try {
        const vanity = await member.guild.fetchVanityData();
        const oldVanityUses = vanityCache.get(guildId) ?? 0;
        if (vanity.uses > oldVanityUses) {
          usedCode = member.guild.vanityURLCode;
        }
        vanityCache.set(guildId, vanity.uses);
      } catch (err) {
        logger.warn({ err, guildId, vanityCode: member.guild.vanityURLCode }, "[invite-tracker] Failed to fetch vanity data");
      }
    }
  } catch (err) {
    logger.debug({ err, guildId, userId: member.id }, "[invite-tracker] Failed to track invite");
  }

  // Discovery / vanity fallback: if no invite was detected through diffing,
  // check Server Discovery first (most common untracked source), then vanity URL.
  // The serialized queue above means the diff-based check is reliable, so reaching
  // here genuinely means no invite was used — prefer Discovery over blind vanity.
  if (!usedCode) {
    if (member.guild.features.includes("DISCOVERABLE")) {
      usedCode = "__discovery__";
      logger.debug({ guildId }, "[invite-tracker] Fallback: attributing to Server Discovery");
    } else if (member.guild.vanityURLCode) {
      usedCode = member.guild.vanityURLCode;
      logger.debug({ guildId, vanityCode: usedCode }, "[invite-tracker] Fallback: attributing to vanity URL");
    }
  }
  upsertStmt().run(guildId, member.id, usedCode, inviterId, Math.floor(Date.now() / 1000));
}

// ===== Lookups =====

/** Look up which invite a user joined with, including a friendly label if configured. */
export function getInviteForUser(
  guildId: string,
  userId: string
): { code: string | null; inviterId: string | null; label: string | null } | null {
  const row = db
    .prepare(
      `SELECT u.invite_code, u.inviter_id, l.label
       FROM invite_usage u
       LEFT JOIN invite_label l ON l.guild_id = u.guild_id AND l.invite_code = u.invite_code
       WHERE u.guild_id = ? AND u.user_id = ?`
    )
    .get(guildId, userId) as { invite_code: string | null; inviter_id: string | null; label: string | null } | undefined;
  return row ? { code: row.invite_code, inviterId: row.inviter_id, label: row.label } : null;
}

// ===== Event handlers =====

/** Update cache when an invite is created. */
export function handleInviteCreate(invite: Invite): void {
  if (!invite.guild) return;
  const guildId = invite.guild.id;
  const cache = inviteCache.get(guildId) ?? new Map();
  cache.set(invite.code, invite.uses ?? 0);
  inviteCache.set(guildId, cache);

  // Persist to snapshot
  try {
    snapshotUpsertStmt().run(guildId, invite.code, invite.uses ?? 0, invite.inviterId ?? null, Math.floor(Date.now() / 1000));
  } catch { /* non-critical */ }
}

/** Update cache when an invite is deleted. */
export function handleInviteDelete(invite: Invite): void {
  if (!invite.guild) return;
  inviteCache.get(invite.guild.id)?.delete(invite.code);
  // Keep snapshot row — we may need inviter_id for attribution of recent joins
}
