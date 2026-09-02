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
import { handlePatreonArtRewards } from "./patreonArtRewards.js";

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
  return (PATREON_ROLE_IDS as Set<string>).has(roleId);
}

/**
 * Check if a member has multiple Patreon donor roles stacked and remove the
 * lower-tier ones, keeping only the highest.
 *
 * Called from guildMemberUpdate when a Patreon donor role is added.
 */
export async function handlePatreonRoleDedup(
  member: GuildMember,
  options: { refetch?: boolean } = {}
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

  // The event path re-fetches the member so an external Patreon bot's role edits that
  // raced our gateway event are visible. The periodic sweep reads the cache instead: a
  // REST fetch per Patreon member per sweep was most of what the sweep cost.
  const fresh =
    options.refetch === false ? member : await guild.members.fetch(member.id).catch(() => null);
  if (!fresh) return;

  // Find all Patreon donor roles this member currently has
  const memberPatreonRoles = PATREON_TIERS.filter((tier) =>
    fresh.roles.cache.has(tier.roleId)
  );

  // 0 or 1 = nothing to dedup
  if (memberPatreonRoles.length <= 1) return;

  // First entry is the highest tier (array is sorted highest → lowest)
  const highest = memberPatreonRoles[0]!;
  const lowerRoles = memberPatreonRoles.slice(1);

  const botId = guild.client.user?.id ?? "system";

  logger.info({
    evt: "patreon_role_dedup",
    guildId: guild.id,
    userId: fresh.id,
    username: fresh.user.username,
    highest: highest.name,
    removing: lowerRoles.map((r) => r.name),
  }, `Deduplicating stacked Patreon roles — keeping ${highest.name}, removing ${lowerRoles.length} lower tier(s)`);

  // discord.js's REST manager queues per-route and respects the X-RateLimit
  // headers Discord returns, so we don't need a manual 1.1s spacer between
  // role removes. Issuing them in parallel lets a member with 5 stacked tiers
  // resolve in ~200ms instead of ~4.4s.
  const results = await Promise.all(
    lowerRoles.map((lower) =>
      removeRole(
        guild,
        fresh.id,
        lower.roleId,
        `patreon_dedup: member has higher tier ${highest.name}`,
        botId
      ).then((result) => ({ lower, result }))
    )
  );

  const removed: string[] = results
    .filter(({ result }) => result.action === "remove")
    .map(({ lower }) => lower.name);

  if (removed.length > 0) {
    await logActionPretty(guild, {
      actorId: botId,
      subjectId: fresh.id,
      action: "role_remove",
      reason: "Patreon tier dedup — removed stacked lower-tier donor roles",
      meta: {
        keptRole: `${highest.name} (<@&${highest.roleId}>)`,
        removedRoles: removed,
        removedCount: removed.length,
      },
    }).catch((err) => {
      logger.warn({ err, guildId: guild.id, userId: fresh.id },
        "[patreonRoleDedup] Failed to log action");
    });
  }
}

/**
 * Sweep all guilds for stacked Patreon donor roles and strip the lower tiers.
 * Fetches members fresh from the API to avoid stale cache issues.
 */
async function sweepOnce(client: Client): Promise<number> {
  let totalFixed = 0;

  for (const [, guild] of client.guilds.cache) {
    if (isPanicMode(guild.id)) continue;

    // One pass over the member cache: role.members per tier filtered the whole cache six
    // times per sweep. Gateway events keep the cache current.
    for (const member of guild.members.cache.values()) {
      let tierCount = 0;
      for (const tier of PATREON_TIERS) {
        if (member.roles.cache.has(tier.roleId)) tierCount++;
      }
      if (tierCount === 0) continue;

      // Dedup stacked roles
      if (tierCount > 1) {
        await handlePatreonRoleDedup(member, { refetch: false });
        totalFixed++;
      }

      // Also check art rewards for every Patreon member (handler has its own toggle/dedup)
      try {
        await handlePatreonArtRewards(member);
      } catch (err) {
        logger.warn({ err, userId: member.id, guildId: guild.id },
          "[patreonRoleDedup] Failed to check art rewards in sweep");
      }
    }
  }

  return totalFixed;
}

/**
 * One-time startup sweep: find all members with stacked Patreon donor roles
 * and strip the lower tiers. Then start a periodic sweep to catch re-stacking
 * from external Patreon integration bots.
 */
let _sweepInterval: NodeJS.Timeout | null = null;

export async function sweepPatreonRoleStacks(client: Client): Promise<void> {
  const totalFixed = await sweepOnce(client);
  logger.info({ totalFixed }, "[patreonRoleDedup] Startup sweep complete");

  // Periodic sweep (hourly by default, PATREON_SWEEP_INTERVAL_MINUTES overrides) to catch
  // roles re-added by external Patreon bots; guildMemberUpdate handles the live cases.
  const minutes = parseInt(process.env.PATREON_SWEEP_INTERVAL_MINUTES ?? "", 10);
  const SWEEP_INTERVAL_MS = (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60 * 1000;
  _sweepInterval = setInterval(async () => {
    try {
      const fixed = await sweepOnce(client);
      if (fixed > 0) {
        logger.info({ fixed }, "[patreonRoleDedup] Periodic sweep fixed stacked roles");
      }
    } catch (err) {
      logger.error({ err }, "[patreonRoleDedup] Periodic sweep failed");
    }
  }, SWEEP_INTERVAL_MS);
  // unref so this timer alone cannot keep the Node event loop alive at shutdown,
  // matching every other recurring timer in the bot process.
  _sweepInterval.unref?.();
}

/** Stop the periodic Patreon role-dedup sweep (graceful shutdown / tests). */
export function stopPatreonRoleDedup(): void {
  if (_sweepInterval) {
    clearInterval(_sweepInterval);
    _sweepInterval = null;
  }
}
