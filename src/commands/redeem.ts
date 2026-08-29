/**
 * Pawtropolis Tech -- src/commands/redeem.ts
 * WHAT: /redeem pulls one item out of a member's inventory and re-issues its role.
 * WHY: The inventory is a storage locker, not a replacement for the existing redemption
 *      flows. Handing the role back means /redeemreward and /usebyte keep working exactly
 *      as they do today, one item at a time.
 * FLOWS:
 *  - /redeem item:<key> -> debit ledger -> suppress capture -> re-issue role
 *  - a failed role write refunds the item, so nothing is ever silently lost
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type AutocompleteInteraction,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { assignRole } from "../features/roleAutomation.js";
import { isPanicMode } from "../features/panicStore.js";
import { getItemByKey, inventoryEnabled } from "../features/inventory/catalog.js";
import { suppressNextCapture, clearSuppression } from "../features/inventory/capture.js";
import { creditItem, debitItem, getInventory } from "../features/inventory/store.js";

export const data = new SlashCommandBuilder()
  .setName("redeem")
  .setDescription("Take one item out of your inventory")
  .addStringOption((opt) =>
    opt
      .setName("item")
      .setDescription("Which item to use")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .setDMPermission(false);

/** Suggest only what the caller actually holds, so an empty stack cannot be picked. */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId || !inventoryEnabled(guildId)) {
    await interaction.respond([]).catch(() => undefined);
    return;
  }

  const typed = interaction.options.getFocused().toLowerCase();
  const choices = getInventory(guildId, interaction.user.id)
    .map((row) => {
      const item = getItemByKey(guildId, row.item_key);
      return { name: `${item?.display ?? row.item_key} (x${row.quantity})`, value: row.item_key };
    })
    .filter((c) => c.name.toLowerCase().includes(typed))
    .slice(0, 25);

  await interaction.respond(choices).catch(() => undefined);
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This command must be run in a server." });
    return;
  }

  if (!inventoryEnabled(guild.id)) {
    await interaction.reply({
      content: "The inventory system is not enabled on this server yet.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (isPanicMode(guild.id)) {
    await interaction.reply({
      content: "Role automation is paused right now. Try again once staff clear panic mode.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const itemKey = interaction.options.getString("item", true);
  const item = getItemByKey(guild.id, itemKey);
  if (!item) {
    await interaction.reply({
      content: "That item does not exist. Pick one from the list `/inventory` shows you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (guild.roles.cache.get(item.roleId) === undefined) {
    await interaction.reply({
      content: `The role behind **${item.display}** is missing from this server. Nothing was spent.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.roles.cache.has(item.roleId)) {
    await interaction.reply({
      content: `You already have a **${item.display}** out. Use that one first, then redeem the next.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Spend first. The UPDATE guards on quantity, so two /redeem calls racing each other
  // cannot both take the last item.
  const spent = await withStep(ctx, "debit_item", () =>
    debitItem(guild.id, interaction.user.id, itemKey, 1, item.source, interaction.user.id, "/redeem")
  );

  if (!spent) {
    await interaction.reply({
      content: `You are not holding a **${item.display}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Tell the capture path to leave this one alone. The audit log executor check would
  // catch it anyway, since we are the ones adding it, but this saves a lookup.
  suppressNextCapture(guild.id, interaction.user.id, item.roleId);

  const result = await withStep(ctx, "issue_role", () =>
    assignRole(guild, interaction.user.id, item.roleId, `inventory_redeem: ${item.display}`,
      guild.client.user?.id ?? "system")
  );

  if (!result.success) {
    clearSuppression(guild.id, interaction.user.id, item.roleId);
    creditItem(guild.id, interaction.user.id, itemKey, 1, item.source, interaction.user.id,
      "refund: role could not be issued");
    logger.warn(
      { guildId: guild.id, userId: interaction.user.id, itemKey, error: result.error },
      "[inventory] redeem failed, item refunded"
    );
    await interaction.reply({
      content: `Could not hand you the **${item.display}** role, so it went back in your inventory. Ping staff if this keeps happening.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const remaining = getInventory(guild.id, interaction.user.id)
    .find((r) => r.item_key === itemKey)?.quantity ?? 0;

  logger.info(
    { evt: "inventory_item_redeemed", guildId: guild.id, userId: interaction.user.id, itemKey, remaining },
    `Redeemed ${item.display}`
  );

  const embed = new EmbedBuilder()
    .setTitle("Item Redeemed")
    .setColor(0x00cc00)
    .setDescription(
      `**${item.display}** is on you now.\n` +
      (remaining > 0 ? `You still have **x${remaining}** stored.` : "That was your last one.")
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
