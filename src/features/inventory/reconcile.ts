// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/inventory/reconcile.ts
 * WHAT: Startup pass that queues catalogued roles granted while the bot was offline.
 * WHY: guildMemberUpdate only fires while we are connected. A deploy or a crash during a
 *      Patreon batch would otherwise lose those items silently.
 *
 * This only queues. Every attribution decision still happens in the capture scheduler, so
 * a role the bot itself handed out through /redeem, or one a mod granted by hand, is
 * released there rather than banked.
 */

import type { Client, Guild } from "discord.js";
import { logger } from "../../lib/logger.js";
import { isPanicMode } from "../panicStore.js";
import { getItemCatalog, inventoryEnabled, sourceBotAllowlist } from "./catalog.js";
import { decideSource, listRecentRoleGrants } from "./executor.js";
import { enqueueCapture } from "./store.js";

export async function reconcileGuildInventory(guild: Guild): Promise<number> {
  if (!inventoryEnabled(guild.id)) return 0;
  if (isPanicMode(guild.id)) return 0;

  const catalog = getItemCatalog(guild.id);
  if (catalog.length === 0) return 0;
  const byRole = new Map(catalog.map((i) => [i.roleId, i]));

  // One audit-log read for the whole guild, not one per held role. Members who have held
  // a reward role since before the log window are unattributable and would be released
  // anyway, so queueing them costs a REST call each and re-costs it on every restart.
  const recentGrants = await listRecentRoleGrants(guild);
  if (recentGrants.size === 0) return 0;

  const selfId = guild.client.user?.id ?? "";
  const allowlist = sourceBotAllowlist(guild.id);

  // Read the cache rather than refetching. ready.ts warms every member at startup and
  // nothing evicts them, so a fetch here would be a second full-guild round trip.
  const members = guild.members.cache;

  // No grace here: the grant already happened, possibly hours ago, so there is no reward
  // bot mid-verification to wait for.
  const removeAtS = Math.floor(Date.now() / 1000);
  let queued = 0;

  for (const member of members.values()) {
    for (const roleId of member.roles.cache.keys()) {
      const item = byRole.get(roleId);
      if (!item) continue;

      // Only roles the audit log can still attribute to a reward bot are worth queueing.
      // The scheduler re-checks before acting; this just keeps the queue to real work.
      const executor = recentGrants.get(`${member.id}:${roleId}`);
      if (!executor) continue;
      if (!decideSource(executor, selfId, allowlist).ok) continue;

      const grantKey = item.policy === "once_per_key" ? `${item.itemKey}:${roleId}` : null;
      if (enqueueCapture(guild.id, member.id, roleId, item.itemKey, removeAtS, grantKey)) {
        queued++;
      }
    }
  }

  if (queued > 0) {
    logger.info(
      { evt: "inventory_reconcile", guildId: guild.id, queued },
      `Queued ${queued} held reward role(s) for inventory attribution`
    );
  }
  return queued;
}

export async function reconcileInventory(client: Client): Promise<number> {
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    total += await reconcileGuildInventory(guild);
  }
  return total;
}
