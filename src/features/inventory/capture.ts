// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/inventory/capture.ts
 * WHAT: Detects catalogued reward roles landing on a member and queues them for banking.
 * WHY: Taylor asked for a delay before the role is taken, so Mimu and Amari can finish
 *      their own post-grant verification. The queue lives in SQLite rather than a
 *      setTimeout so a restart mid-window does not lose the item.
 * FLOWS:
 *  - guildMemberUpdate -> handleItemRoleAdded -> pending_item_capture
 *  - itemCaptureScheduler drains the queue once the window expires
 */

import type { GuildMember, PartialGuildMember } from "discord.js";
import { logger } from "../../lib/logger.js";
import { isPanicMode } from "../panicStore.js";
import { getItemByRoleId, graceSeconds, inventoryEnabled } from "./catalog.js";
import type { GrantPolicy } from "./catalog.js";
import { enqueueCapture } from "./store.js";

/**
 * Roles this bot re-issued through /redeem, held briefly so the capture path skips them
 * without paying for an audit log fetch. The audit log executor check is the real guard;
 * losing this map on restart costs one wasted lookup, nothing more.
 */
const suppressed = new Map<string, number>();
const SUPPRESSION_TTL_MS = 5 * 60 * 1000;

function suppressionKey(guildId: string, userId: string, roleId: string): string {
  return `${guildId}:${userId}:${roleId}`;
}

export function suppressNextCapture(guildId: string, userId: string, roleId: string): void {
  suppressed.set(suppressionKey(guildId, userId, roleId), Date.now() + SUPPRESSION_TTL_MS);
}

export function isSuppressed(guildId: string, userId: string, roleId: string): boolean {
  const key = suppressionKey(guildId, userId, roleId);
  const until = suppressed.get(key);
  if (until === undefined) return false;
  if (until < Date.now()) {
    suppressed.delete(key);
    return false;
  }
  return true;
}

export function clearSuppression(guildId: string, userId: string, roleId: string): void {
  suppressed.delete(suppressionKey(guildId, userId, roleId));
}

/** Test seam: drop all suppression state. */
export function resetSuppression(): void {
  suppressed.clear();
}

/**
 * What to do with a queued capture once dedup has been evaluated.
 *  - credit: bank a new item and take the role
 *  - absorb: take the role without banking, because this grant is a reward-bot re-sync
 *            of an item the member already holds
 */
export type DedupOutcome = "credit" | "absorb";

/**
 * Kept pure so the policy can be tested without a database or a gateway.
 * @param grantKeyFree - for once_per_key items, whether this grant key was still unused
 * @param debounceHit  - for every_grant items, whether the same item was credited inside
 *                       the debounce window
 */
export function decideDedup(
  policy: GrantPolicy,
  grantKeyFree: boolean,
  debounceHit: boolean
): DedupOutcome {
  if (policy === "once_per_key") return grantKeyFree ? "credit" : "absorb";
  return debounceHit ? "absorb" : "credit";
}

/**
 * Queue every newly added catalogued role for capture.
 * Runs on the gateway hot path, so it does no network work: the audit log lookup and the
 * role removal both happen later, in the scheduler.
 */
export function handleItemRoleAdded(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): void {
  const guildId = newMember.guild.id;
  if (!inventoryEnabled(guildId)) return;
  if (isPanicMode(guildId)) return;

  const grace = graceSeconds(guildId);
  const removeAtS = Math.floor(Date.now() / 1000) + grace;

  for (const [roleId] of newMember.roles.cache) {
    if (oldMember.roles.cache.has(roleId)) continue;

    const item = getItemByRoleId(guildId, roleId);
    if (!item) continue;

    if (isSuppressed(guildId, newMember.id, roleId)) {
      clearSuppression(guildId, newMember.id, roleId);
      logger.debug(
        { guildId, userId: newMember.id, roleId, itemKey: item.itemKey },
        "[inventory] skipping capture of a role we re-issued"
      );
      continue;
    }

    const grantKey = item.policy === "once_per_key" ? `${item.itemKey}:${roleId}` : null;
    const queued = enqueueCapture(guildId, newMember.id, roleId, item.itemKey, removeAtS, grantKey);

    if (queued) {
      logger.info(
        {
          evt: "inventory_capture_queued",
          guildId,
          userId: newMember.id,
          roleId,
          itemKey: item.itemKey,
          graceSeconds: grace,
        },
        `Queued ${item.display} for inventory capture in ${grace}s`
      );
    }
  }
}
