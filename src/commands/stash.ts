/**
 * Pawtropolis Tech -- src/commands/stash.ts
 * WHAT: /stash shows the reward items a member is holding.
 * WHY: Reward roles do not stack, so a second copy used to vanish. The ledger holds the
 *      real count and this is how a member reads it back.
 * FLOWS:
 *  - /stash            -> your own stacks
 *  - /stash user:@Them -> staff view of someone else
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type GuildMember,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { hasRoleOrAbove, ROLE_IDS } from "../lib/roles.js";
import { getAmbassadorRoleId } from "../features/artistRotation/index.js";
import { displayForKey, inventoryEnabled } from "../features/inventory/catalog.js";
import { getInventory } from "../features/inventory/store.js";

export const data = new SlashCommandBuilder()
  .setName("stash")
  .setDescription("See the reward items you are holding")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("Staff only: view someone else's stash")
      .setRequired(false)
  )
  .setDMPermission(false);

function isStaffViewer(member: GuildMember | null, guildId: string, canManageRoles: boolean): boolean {
  if (!member) return false;
  if (canManageRoles) return true;
  if (hasRoleOrAbove(member, ROLE_IDS.JUNIOR_MOD)) return true;
  return member.roles.cache.has(getAmbassadorRoleId(guildId));
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

  const requested = interaction.options.getUser("user");
  const viewer = interaction.member as GuildMember | null;
  const canManageRoles = interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) ?? false;

  if (requested && requested.id !== interaction.user.id && !isStaffViewer(viewer, guild.id, canManageRoles)) {
    await interaction.reply({
      content: "You can only view your own stash.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = requested ?? interaction.user;

  const rows = await withStep(ctx, "read_inventory", () => getInventory(guild.id, target.id));

  const embed = new EmbedBuilder()
    .setTitle(target.id === interaction.user.id ? "Your Stash" : `Stash: ${target.username}`)
    .setColor(0xf59e0b);

  if (rows.length === 0) {
    embed.setDescription(
      target.id === interaction.user.id
        ? "Nothing stored yet. Reward items land here automatically when you earn them."
        : `<@${target.id}> is not holding any reward items.`
    );
  } else {
    const total = rows.reduce((sum, r) => sum + r.quantity, 0);
    embed.setDescription(
      rows.map((r) => `**x${r.quantity}** ${displayForKey(guild.id, r.item_key)}`).join("\n")
    );
    embed.setFooter({
      text:
        `${total} item${total === 1 ? "" : "s"} across ${rows.length} stack${rows.length === 1 ? "" : "s"}` +
        " | /redeem to cash one in",
    });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
