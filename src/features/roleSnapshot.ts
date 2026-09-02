// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/roleSnapshot.ts
 * WHAT: Capture member roles on leave/kick/ban; restore them on rejoin via /restoreroles.
 * WHY: Returning members lose all roles. Mods otherwise re-grant manually.
 * FLOWS:
 *  - guildMemberRemove → snapshotMemberRoles() → row in member_role_snapshots
 *  - audit log lookup → classifyRemoval() → updates removal_type/reason
 *  - /restoreroles → restoreRoles() → re-applies snapshot, marks restored
 */

import {
  AuditLogEvent,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
} from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

const DEDUPE_WINDOW_SEC = 5;
// Audit log entries up to ~10s old can plausibly belong to this removal event.
const AUDIT_LOOKUP_WINDOW_MS = 10_000;

export type RemovalType = "left" | "kicked" | "banned" | "unknown";

export interface SnapshotRow {
  id: number;
  guild_id: string;
  user_id: string;
  role_ids: string;
  removal_type: RemovalType;
  reason: string | null;
  executor_id: string | null;
  removed_at: number;
  restored_at: number | null;
  restored_by: string | null;
}

export interface RestoreReport {
  notFound: boolean;
  snapshotId?: number;
  removalType?: RemovalType;
  removedAt?: number;
  restored: string[];
  skipped: Array<{ roleId: string; reason: string }>;
}

/**
 * Capture role state at the moment a member is removed from the guild.
 * Returns the inserted snapshot row id, or null if skipped (no roles, or dedupe).
 */
export function snapshotMemberRoles(
  member: GuildMember | PartialGuildMember
): number | null {
  if (!member.guild) return null;
  const guildId = member.guild.id;
  const userId = member.id;

  // Partial members (uncached) can have empty roles cache. Without GuildMembers
  // chunking the role list may be missing — log and skip rather than write a
  // misleading empty snapshot.
  const rolesCache = member.roles?.cache;
  if (!rolesCache) {
    logger.warn({ guildId, userId }, "[roleSnapshot] no roles.cache (partial?); skipping");
    return null;
  }

  const filtered = rolesCache.filter((role) => {
    if (role.id === guildId) return false; // @everyone
    if (role.managed) return false;        // booster, integrations, bot roles
    return true;
  });

  if (filtered.size === 0) {
    return null;
  }

  // Dedupe: if a snapshot for this (guild, user) was written within the last
  // DEDUPE_WINDOW_SEC seconds, skip — Discord can replay events on reconnect.
  const recent = db
    .prepare(
      `SELECT id FROM member_role_snapshots
       WHERE guild_id = ? AND user_id = ?
         AND removed_at >= (strftime('%s', 'now') - ?)
       ORDER BY removed_at DESC
       LIMIT 1`
    )
    .get(guildId, userId, DEDUPE_WINDOW_SEC) as { id: number } | undefined;
  if (recent) {
    logger.info({ guildId, userId, existingId: recent.id }, "[roleSnapshot] dedupe — recent snapshot exists");
    return recent.id;
  }

  const roleIds = filtered.map((r) => r.id);
  const result = db
    .prepare(
      `INSERT INTO member_role_snapshots (guild_id, user_id, role_ids, removal_type)
       VALUES (?, ?, ?, 'unknown')`
    )
    .run(guildId, userId, JSON.stringify(roleIds));

  const id = Number(result.lastInsertRowid);
  logger.info(
    { guildId, userId, snapshotId: id, roleCount: roleIds.length },
    "[roleSnapshot] captured roles on member removal"
  );
  return id;
}

/**
 * Best-effort: classify the removal as left/kicked/banned via audit log lookup.
 * Updates the snapshot row in place. Failures are swallowed — the snapshot
 * remains usable as 'unknown'.
 */
export async function classifyRemoval(
  guild: Guild,
  userId: string,
  snapshotId: number
): Promise<void> {
  try {
    // One untyped fetch covers both ban and kick entries (this used to be two REST calls
    // per member leave). Ban is checked first: more severe, takes precedence over kick.
    const logs = await guild.fetchAuditLogs({ limit: 10 });
    const matches = (action: AuditLogEvent) =>
      logs.entries.find(
        (e) =>
          e.action === action &&
          (e.target as { id?: string } | null)?.id === userId &&
          Date.now() - e.createdTimestamp <= AUDIT_LOOKUP_WINDOW_MS
      );

    const banEntry = matches(AuditLogEvent.MemberBanAdd);
    if (banEntry) {
      updateClassification(snapshotId, "banned", banEntry.reason ?? null, banEntry.executor?.id ?? null);
      return;
    }

    const kickEntry = matches(AuditLogEvent.MemberKick);
    if (kickEntry) {
      updateClassification(snapshotId, "kicked", kickEntry.reason ?? null, kickEntry.executor?.id ?? null);
      return;
    }

    // No matching audit entry → user left voluntarily.
    updateClassification(snapshotId, "left", null, null);
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id, userId, snapshotId },
      "[roleSnapshot] audit log classification failed; leaving as 'unknown'"
    );
  }
}

function updateClassification(
  snapshotId: number,
  type: RemovalType,
  reason: string | null,
  executorId: string | null
): void {
  db.prepare(
    `UPDATE member_role_snapshots
     SET removal_type = ?, reason = ?, executor_id = ?
     WHERE id = ?`
  ).run(type, reason, executorId, snapshotId);
}

/**
 * Read the most recent snapshot for a (guild, user). Used by /restoreroles.
 */
export function getLatestSnapshot(guildId: string, userId: string): SnapshotRow | null {
  const row = db
    .prepare(
      `SELECT * FROM member_role_snapshots
       WHERE guild_id = ? AND user_id = ?
       ORDER BY removed_at DESC
       LIMIT 1`
    )
    .get(guildId, userId) as SnapshotRow | undefined;
  return row ?? null;
}

/**
 * Re-apply the most recent snapshot's roles to a member.
 * Filters: deleted roles, managed roles, @everyone, roles already held,
 * and roles at-or-above the bot's highest role (Discord hierarchy).
 */
export async function restoreRoles(
  member: GuildMember,
  executorId: string,
  options: { dryRun?: boolean } = {}
): Promise<RestoreReport> {
  const guild = member.guild;
  const snap = getLatestSnapshot(guild.id, member.id);
  if (!snap) {
    return { notFound: true, restored: [], skipped: [] };
  }

  let roleIds: string[];
  try {
    roleIds = JSON.parse(snap.role_ids) as string[];
  } catch {
    logger.error({ snapshotId: snap.id }, "[roleSnapshot] corrupt role_ids JSON");
    return { notFound: true, restored: [], skipped: [] };
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  const botTopPosition = me.roles.highest.position;

  const toApply: string[] = [];
  const skipped: Array<{ roleId: string; reason: string }> = [];

  for (const roleId of roleIds) {
    if (roleId === guild.id) {
      skipped.push({ roleId, reason: "@everyone" });
      continue;
    }
    if (member.roles.cache.has(roleId)) {
      skipped.push({ roleId, reason: "already has role" });
      continue;
    }
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      skipped.push({ roleId, reason: "role no longer exists" });
      continue;
    }
    if (role.managed) {
      skipped.push({ roleId, reason: "managed role (booster/integration)" });
      continue;
    }
    if (role.position >= botTopPosition) {
      skipped.push({ roleId, reason: "above bot's highest role" });
      continue;
    }
    toApply.push(roleId);
  }

  if (options.dryRun) {
    return {
      notFound: false,
      snapshotId: snap.id,
      removalType: snap.removal_type,
      removedAt: snap.removed_at,
      restored: toApply,
      skipped,
    };
  }

  if (toApply.length > 0) {
    await member.roles.add(
      toApply,
      `Restored via /restoreroles by ${executorId} (snapshot #${snap.id})`
    );
    db.prepare(
      `UPDATE member_role_snapshots
       SET restored_at = strftime('%s', 'now'), restored_by = ?
       WHERE id = ?`
    ).run(executorId, snap.id);
  }

  logger.info(
    {
      guildId: guild.id,
      userId: member.id,
      snapshotId: snap.id,
      restoredCount: toApply.length,
      skippedCount: skipped.length,
      executorId,
    },
    "[roleSnapshot] restore complete"
  );

  return {
    notFound: false,
    snapshotId: snap.id,
    removalType: snap.removal_type,
    removedAt: snap.removed_at,
    restored: toApply,
    skipped,
  };
}
