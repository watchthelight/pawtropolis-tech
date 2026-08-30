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
import { getInventory, pendingCapturesForUser } from "../features/inventory/store.js";
import { buildStashView } from "../features/inventory/stashView.js";

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

  const pending = await withStep(ctx, "read_pending_captures", () =>
    pendingCapturesForUser(guild.id, target.id)
  );

  const isSelf = target.id === interaction.user.id;
  const view = buildStashView(
    rows.map((r) => ({ itemKey: r.item_key, quantity: r.quantity })),
    pending.map((p) => ({ itemKey: p.item_key, removeAtS: p.remove_at_s })),
    (key) => displayForKey(guild.id, key),
    isSelf,
    target.id,
    Math.floor(Date.now() / 1000)
  );

  const embed = new EmbedBuilder()
    .setTitle(isSelf ? "Your Stash" : `Stash: ${target.username}`)
    .setColor(0xf59e0b)
    .setDescription(view.description);

  if (view.footer) embed.setFooter({ text: view.footer });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
