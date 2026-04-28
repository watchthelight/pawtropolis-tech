/**
 * Pawtropolis Tech -- src/features/tickets/handlers.ts
 * WHAT: Button + modal interaction handlers for the ticket system.
 *       This phase wires the `tk:open:<typeKey>` button (panel → new ticket).
 *       Claim, Close, and modal handlers ship in P5.
 * WHY: Keeps interaction code out of src/index.ts beyond the dispatch hop.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { COMMUNITY_AMBASSADOR_ROLE_ID, MOD_TEAM_ROLE_ID } from "./config.js";
import { TicketService } from "./service.js";
import { getTicketType } from "./registry.js";

/** True if the actor holds Community Ambassador OR Mod Team. */
function actorIsStaff(member: GuildMember | null): boolean {
  if (!member) return false;
  return (
    member.roles.cache.has(COMMUNITY_AMBASSADOR_ROLE_ID) ||
    member.roles.cache.has(MOD_TEAM_ROLE_ID)
  );
}

/**
 * Top-level dispatch for any customId that starts with `tk:`. The src/index.ts
 * router calls this and we sub-route by the second segment.
 */
export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;
  // customId shape: tk:<verb>:<rest>
  const [, verb, ...rest] = customId.split(":");
  switch (verb) {
    case "open":
      return handleOpenButton(interaction, rest.join(":"));
    case "claim":
      return handleClaimButton(interaction, rest.join(":"));
    case "unclaim":
      return handleUnclaimButton(interaction, rest.join(":"));
    default:
      logger.warn(
        { customId },
        "[tickets/handlers] unknown verb in tk: customId — ignoring"
      );
      await interaction.reply({
        content: "Unknown ticket action.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

async function handleClaimButton(
  interaction: ButtonInteraction,
  ticketId: string
): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: "Run inside a guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = interaction.member as GuildMember;
  if (!actorIsStaff(member)) {
    await interaction.reply({
      content: "Only Community Ambassadors or Mod Team can claim tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await TicketService.claim(ticketId, interaction.user.id, interaction.guild);
    await interaction.editReply({ content: "Claimed." });
  } catch (err) {
    logger.warn({ err, ticketId }, "[tickets/handlers] claim failed");
    await interaction.editReply({
      content: `Failed to claim: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }
}

async function handleUnclaimButton(
  interaction: ButtonInteraction,
  ticketId: string
): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: "Run inside a guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = interaction.member as GuildMember;
  if (!actorIsStaff(member)) {
    await interaction.reply({
      content: "Only Community Ambassadors or Mod Team can unclaim tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await TicketService.unclaim(ticketId, interaction.user.id, interaction.guild);
    await interaction.editReply({ content: "Unclaimed." });
  } catch (err) {
    logger.warn({ err, ticketId }, "[tickets/handlers] unclaim failed");
    await interaction.editReply({
      content: `Failed to unclaim: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }
}

async function handleOpenButton(
  interaction: ButtonInteraction,
  typeKey: string
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Tickets can only be opened inside a guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const type = getTicketType(typeKey);
  if (!type || !type.isActive) {
    await interaction.reply({
      content: "That ticket type is not available right now.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { ticket, channel } = await TicketService.create({
      typeKey,
      guild: interaction.guild,
      openerUserId: interaction.user.id,
    });
    await interaction.editReply({
      content: `Ticket opened: <#${channel.id}> (\`${type.key}-${String(ticket.number).padStart(4, "0")}\`)`,
    });
  } catch (err) {
    logger.error(
      { err, typeKey, openerUserId: interaction.user.id },
      "[tickets/handlers] failed to open ticket"
    );
    const detail = err instanceof Error ? err.message : "unknown error";
    await interaction.editReply({
      content: `Failed to open ticket: ${detail}`,
    });
  }
}
