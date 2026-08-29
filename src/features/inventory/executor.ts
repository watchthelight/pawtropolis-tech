// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/inventory/executor.ts
 * WHAT: Works out who put a role on a member, and whether that grant should be banked.
 * WHY: guildMemberUpdate says a role appeared, never who added it. Without that, a mod
 *      handing out a ticket by hand gets it swallowed, and our own /redeem re-issue is
 *      captured straight back into inventory in a loop.
 * DOCS: https://discord.js.org/docs/packages/discord.js/main/Guild:Class#fetchAuditLogs
 */

import { AuditLogEvent, type Guild } from "discord.js";
import { logger } from "../../lib/logger.js";

export interface RoleGrantExecutor {
  id: string;
  isBot: boolean;
}

// A day of lookback so the startup reconcile can still attribute roles granted while the
// bot was down. Anything older resolves to null and is left alone, which is the safe way
// to be wrong: an unattributable role stays on the member.
const AUDIT_LOG_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const AUDIT_LOG_FETCH_LIMIT = 100;

/**
 * Find the actor behind the most recent add of roleId to userId.
 * RETURNS: null when the entry cannot be found or audit logs are unreadable. Callers
 *          treat null as "do not capture": failing closed leaves a role in place, while
 *          failing open would eat a role nobody asked us to take.
 */
export async function resolveRoleGrantExecutor(
  guild: Guild,
  userId: string,
  roleId: string
): Promise<RoleGrantExecutor | null> {
  let logs;
  try {
    logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: AUDIT_LOG_FETCH_LIMIT,
    });
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id, userId, roleId },
      "[inventory] could not read audit logs, cannot verify who granted the role"
    );
    return null;
  }

  const cutoff = Date.now() - AUDIT_LOG_LOOKBACK_MS;

  for (const entry of logs.entries.values()) {
    if (entry.createdTimestamp < cutoff) break; // entries are newest first
    if (entry.target?.id !== userId) continue;

    const added = entry.changes.find((c) => c.key === "$add");
    if (!added || !Array.isArray(added.new)) continue;
    if (!(added.new as Array<{ id?: string }>).some((r) => r?.id === roleId)) continue;
    if (!entry.executor) return null;

    return { id: entry.executor.id, isBot: Boolean(entry.executor.bot) };
  }

  return null;
}

export interface SourceVerdict {
  ok: boolean;
  reason: string;
}

/**
 * Decide whether a grant from this actor belongs in inventory.
 * Kept free of discord.js so the policy itself is directly testable.
 *
 * An empty allowlist means "any bot except us". Mods keep working by hand, and our own
 * re-issues from /redeem are never taken back.
 */
export function decideSource(
  executor: RoleGrantExecutor | null,
  selfId: string,
  allowlist: Set<string>
): SourceVerdict {
  if (!executor) return { ok: false, reason: "unknown_executor" };
  if (executor.id === selfId) return { ok: false, reason: "self_grant" };
  if (allowlist.size > 0) {
    return allowlist.has(executor.id)
      ? { ok: true, reason: "allowlisted_bot" }
      : { ok: false, reason: "not_allowlisted" };
  }
  if (!executor.isBot) return { ok: false, reason: "manual_grant" };
  return { ok: true, reason: "reward_bot" };
}
