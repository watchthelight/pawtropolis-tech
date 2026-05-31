/**
 * Pawtropolis Tech -- src/features/tickets/handlers.ts
 * WHAT: Button + modal interaction handlers for the ticket system.
 *       This phase wires the `tk:open:<typeKey>` button (panel → new ticket).
 *       Claim, Close, and modal handlers ship in P5.
 * WHY: Keeps interaction code out of src/index.ts beyond the dispatch hop.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { checkCooldown, formatCooldown } from "../../lib/rateLimiter.js";
import { COMMUNITY_AMBASSADOR_ROLE_ID, MOD_TEAM_ROLE_ID } from "./config.js";
import { TicketService } from "./service.js";
import { getTicketType } from "./registry.js";

// Short anti-double-click window. Discord button double-clicks dispatch as two
// separate interactions; the first defers but is not yet replied, so the second
// is still valid. Gating per (user, ticket type) stops a double-click from
// opening two channels / burning two numbers / firing duplicate staff pings.
const TICKET_OPEN_COOLDOWN_MS = 5000;

export const CLOSE_MODAL_ID_PREFIX = "tk:closemod:";

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
    case "close":
      return handleCloseButton(interaction, rest.join(":"));
    case "asncf": {
      const { handleAssignConfirm } = await import("../../commands/assignticket.js");
      return handleAssignConfirm(interaction);
    }
    case "asncx": {
      const { handleAssignCancel } = await import("../../commands/assignticket.js");
      return handleAssignCancel(interaction);
    }
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

async function handleCloseButton(
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
      content: "Only Community Ambassadors or Mod Team can close tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Show reason-collection modal. Must NOT defer before showModal.
  const modal = new ModalBuilder()
    .setCustomId(`${CLOSE_MODAL_ID_PREFIX}${ticketId}`)
    .setTitle("Close ticket")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason for closing")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(500)
          .setPlaceholder("Resolved / abandoned / duplicate / etc. — visible in transcript.")
      )
    );
  await interaction.showModal(modal);
}

/**
 * Modal-submit handler for tk:closemod:<ticketId>. Reads the reason field and
 * delegates to TicketService.close.
 */
export async function handleCloseModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.customId.startsWith(CLOSE_MODAL_ID_PREFIX)) return;
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
      content: "Only Community Ambassadors or Mod Team can close tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ticketId = interaction.customId.slice(CLOSE_MODAL_ID_PREFIX.length);
  const reason = interaction.fields.getTextInputValue("reason").trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await TicketService.close(ticketId, {
      closedByUserId: interaction.user.id,
      reason,
      guild: interaction.guild,
    });
    await interaction.editReply({ content: "Ticket closed." });
  } catch (err) {
    logger.error({ err, ticketId }, "[tickets/handlers] close failed");
    await interaction.editReply({
      content: `Failed to close: ${err instanceof Error ? err.message : "unknown"}`,
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

  const cooldown = checkCooldown(`ticket:open:${typeKey}`, interaction.user.id, TICKET_OPEN_COOLDOWN_MS);
  if (!cooldown.allowed) {
    await interaction.reply({
      content: `You just opened a ticket of this type. Please wait ${formatCooldown(cooldown.remainingMs ?? 0)} before opening another.`,
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
