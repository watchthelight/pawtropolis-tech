/**
 * Pawtropolis Tech -- src/commands/closeticket.ts
 * WHAT: Slash-command alternative to the red Close button on the greeting embed.
 *       Runs inside a ticket channel, takes an optional reason, closes the ticket.
 * WHY: Some staff prefer keyboard-driven flow; also useful when the greeting
 *      message is no longer visible (scrolled away in a long conversation).
 *
 * PERMISSIONS: Community Ambassador OR Mod Team. Same gate as the button.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import {
  COMMUNITY_AMBASSADOR_ROLE_ID,
  MOD_TEAM_ROLE_ID,
} from "../features/tickets/config.js";
import { TicketService } from "../features/tickets/service.js";

export const data = new SlashCommandBuilder()
  .setName("closeticket")
  .setDescription("Close the ticket in the current channel.")
  .addStringOption((opt) =>
    opt
      .setName("reason")
      .setDescription("Reason for closing — saved in transcript.")
      .setRequired(false)
      .setMaxLength(500)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: "Run inside a guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = interaction.member as GuildMember;
  if (
    !member.roles.cache.has(COMMUNITY_AMBASSADOR_ROLE_ID) &&
    !member.roles.cache.has(MOD_TEAM_ROLE_ID)
  ) {
    await interaction.reply({
      content: "Only Community Ambassadors or Mod Team can close tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channelId = interaction.channelId;
  if (!channelId) {
    await interaction.reply({
      content: "No channel context.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const ticket = TicketService.findByChannelId(channelId);
  if (!ticket) {
    await interaction.reply({
      content: "This channel is not a tracked ticket. Use this command inside a ticket channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (ticket.status === "closed") {
    await interaction.reply({
      content: "Ticket already closed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason =
    interaction.options.getString("reason", false)?.trim() || "(closed via /closeticket — no reason given)";

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await TicketService.close(ticket.id, {
      closedByUserId: interaction.user.id,
      reason,
      guild: interaction.guild,
    });
    await interaction.editReply({ content: "Ticket closed." });
  } catch (err) {
    logger.error({ err, ticketId: ticket.id }, "[closeticket] failed");
    await interaction.editReply({
      content: `Failed to close: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }
}
