// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/inventory/mimuGrants.ts
 * WHAT: Banks a Mimu shop purchase from Mimu's own confirmation message.
 * WHY: Handing a member a role they already hold is a no-op on Discord. No
 *      guildMemberUpdate fires and no audit-log entry is written, so the capture path
 *      cannot see it and the second copy is lost. Mimu's reply is the only evidence
 *      that the purchase happened.
 * FLOWS:
 *  - messageCreate -> handleMimuShopGrant -> creditItem
 *
 * This is the authoritative credit path for Mimu: one confirmation message is exactly
 * one purchase. When the role was genuinely new the capture path still queues it, and
 * the drain absorbs rather than credits because creditedWithin already sees this row.
 */

import type { Message } from "discord.js";
import { logger } from "../../lib/logger.js";
import { isPanicMode } from "../panicStore.js";
import { getItemByRoleId, inventoryEnabled } from "./catalog.js";
import { claimGrantKey, creditItem } from "./store.js";

export const MIMU_BOT_ID = "493716749342998541";

export interface ShopGrant {
  roleId: string;
  itemLabel: string | null;
}

/**
 * Pull the granted role out of a Mimu shop confirmation.
 * Live sample: "you have used BoyKisser [Cosmetic] . . . \nand you were given the <@&1130461373504159844> role!"
 * The role arrives as a mention inside the embed, never in message.mentions, so it has
 * to come from the text.
 */
export function parseShopGrant(description: string): ShopGrant | null {
  const role = /you were given the <@&(\d+)> role/i.exec(description);
  if (!role?.[1]) return null;

  const label = /you have used\s+(.+?)\s*\.\s*\.\s*\./i.exec(description);
  return { roleId: role[1], itemLabel: label?.[1]?.trim() ?? null };
}

/** True when the text looks like a grant we failed to parse, i.e. Mimu changed its wording. */
export function looksLikeGrant(description: string): boolean {
  return /you were given/i.test(description);
}

export async function handleMimuShopGrant(message: Message): Promise<void> {
  if (message.author.id !== MIMU_BOT_ID) return;

  const guild = message.guild;
  if (!guild) return;
  if (!inventoryEnabled(guild.id)) return;
  if (isPanicMode(guild.id)) return;

  const description = message.embeds[0]?.description;
  if (!description) return;

  const grant = parseShopGrant(description);
  if (!grant) {
    if (looksLikeGrant(description)) {
      logger.warn(
        { guildId: guild.id, messageId: message.id, description },
        "[inventory] Mimu grant message did not parse, the wording may have changed"
      );
    }
    return;
  }

  const item = getItemByRoleId(guild.id, grant.roleId);
  if (!item) {
    logger.debug(
      { guildId: guild.id, roleId: grant.roleId },
      "[inventory] Mimu granted a role that is not an inventory item"
    );
    return;
  }

  const userId = message.interactionMetadata?.user?.id;
  if (!userId) {
    logger.warn(
      { guildId: guild.id, messageId: message.id, itemKey: item.itemKey },
      "[inventory] Mimu grant has no interaction user, cannot tell who bought it"
    );
    return;
  }

  // The message id is the purchase id. A replayed event or a restart mid-handler cannot
  // credit the same purchase twice.
  if (!claimGrantKey(guild.id, userId, `mimu:${message.id}`)) return;

  const quantity = creditItem(
    guild.id,
    userId,
    item.itemKey,
    1,
    item.source,
    MIMU_BOT_ID,
    `mimu shop use: ${message.id}`
  );

  logger.info(
    {
      evt: "inventory_mimu_credited",
      guildId: guild.id,
      userId,
      itemKey: item.itemKey,
      quantity,
      messageId: message.id,
    },
    `Banked ${item.display} from a Mimu purchase (now x${quantity})`
  );

  const member = await guild.members.fetch(userId).catch(() => null);
  await member
    ?.send({
      content:
        `**${item.display}** was added to your inventory (now **x${quantity}**).\n` +
        "Use `/stash` to see everything you're holding, and `/redeem` when you want to use one.",
    })
    .catch(() => undefined);
}
