// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/patreonRoleDedup.ts
 * WHAT: Deduplicates stacked Patreon donor roles on tier upgrade
 * WHY: When a member upgrades their Patreon tier, the old role isn't removed
 *      automatically — this causes stacked multipliers. We detect the overlap
 *      and strip lower-tier roles, keeping only the highest.
 * FLOWS:
 *  - guildMemberUpdate detects Patreon role added → check for stacked tiers → remove lower ones
 */

import type { Client, GuildMember } from "discord.js";
import { logger } from "../lib/logger.js";
import { removeRole } from "./roleAutomation.js";
import { isPanicMode } from "./panicStore.js";
import { logActionPretty } from "../logging/pretty.js";

// Patreon donor roles ordered highest → lowest tier.
// IDs from docs/internal-info/ROLES.md
const PATREON_TIERS = [
  { name: "[Patreon] Legendary Fiona", roleId: "1246000607383257118" },
  { name: "[Patreon] City Benefactor", roleId: "1385490737142960188" },
  { name: "[Patreon] Mayor",           roleId: "1201053392076820592" },
  { name: "[Patreon] Council Member",  roleId: "1385565132767232124" },
  { name: "[Patreon] City Worker",     roleId: "1201053311336448040" },
  { name: "[Patreon] Citizen",         roleId: "1201048785565012028" },
] as const;

const PATREON_ROLE_IDS = new Set(PATREON_TIERS.map((t) => t.roleId));

/** Returns true if the role ID is a Patreon donor tier role. */
export function isPatreonDonorRole(roleId: string): boolean {
  return PATREON_ROLE_IDS.has(roleId);
}

/**
 * Check if a member has multiple Patreon donor roles stacked and remove the
 * lower-tier ones, keeping only the highest.
 *
 * Called from guildMemberUpdate when a Patreon donor role is added.
 */
export async function handlePatreonRoleDedup(
  member: GuildMember
): Promise<void> {
  const guild = member.guild;

  if (isPanicMode(guild.id)) {
    logger.warn({
      evt: "patreon_dedup_blocked_panic",
      guildId: guild.id,
      userId: member.id,
    }, "Patreon role dedup blocked - panic mode active");
    return;
  }

  // Find all Patreon donor roles this member currently has
  const memberPatreonRoles = PATREON_TIERS.filter((tier) =>
    member.roles.cache.has(tier.roleId)
  );

  // 0 or 1 = nothing to dedup
  if (memberPatreonRoles.length <= 1) return;

  // First entry is the highest tier (array is sorted highest → lowest)
  const highest = memberPatreonRoles[0];
  const lowerRoles = memberPatreonRoles.slice(1);

  const botId = guild.client.user?.id ?? "system";

  logger.info({
    evt: "patreon_role_dedup",
    guildId: guild.id,
    userId: member.id,
    username: member.user.username,
    highest: highest.name,
    removing: lowerRoles.map((r) => r.name),
  }, `Deduplicating stacked Patreon roles — keeping ${highest.name}, removing ${lowerRoles.length} lower tier(s)`);

  // Remove lower-tier roles sequentially to respect Discord rate limits
  const ROLE_REMOVE_DELAY_MS = 1100;
  const removed: string[] = [];

  for (let i = 0; i < lowerRoles.length; i++) {
    const lower = lowerRoles[i];
    const result = await removeRole(
      guild,
      member.id,
      lower.roleId,
      `patreon_dedup: member has higher tier ${highest.name}`,
      botId
    );

    if (result.action === "remove") {
      removed.push(lower.name);
    }

    if (i < lowerRoles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, ROLE_REMOVE_DELAY_MS));
    }
  }

  if (removed.length > 0) {
    await logActionPretty(guild, {
      actorId: botId,
      subjectId: member.id,
      action: "role_remove",
      reason: "Patreon tier dedup — removed stacked lower-tier donor roles",
      meta: {
        keptRole: `${highest.name} (<@&${highest.roleId}>)`,
        removedRoles: removed,
        removedCount: removed.length,
      },
    }).catch((err) => {
      logger.warn({ err, guildId: guild.id, userId: member.id },
        "[patreonRoleDedup] Failed to log action");
    });
  }
}

/**
 * One-time startup sweep: find all members with stacked Patreon donor roles
 * and strip the lower tiers. Catches any stacking that happened before the
 * reactive guildMemberUpdate handler was deployed.
 */
export async function sweepPatreonRoleStacks(client: Client): Promise<void> {
  let totalFixed = 0;

  for (const [, guild] of client.guilds.cache) {
    if (isPanicMode(guild.id)) continue;

    // Fetch all members who have at least one Patreon donor role
    const members = guild.members.cache.filter((m) =>
      PATREON_TIERS.some((t) => m.roles.cache.has(t.roleId))
    );

    for (const [, member] of members) {
      const memberTiers = PATREON_TIERS.filter((t) => member.roles.cache.has(t.roleId));
      if (memberTiers.length <= 1) continue;

      await handlePatreonRoleDedup(member);
      totalFixed++;
    }
  }

  logger.info({ totalFixed }, "[patreonRoleDedup] Startup sweep complete");
}
