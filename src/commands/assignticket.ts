/**
 * Pawtropolis Tech -- src/commands/assignticket.ts
 * WHAT: Manually swap the assigned artist on a first-party art-style ticket.
 *       Replaces today's "edit Ticket Tool roster + manually update DB" dance
 *       with one slash command that does both, atomically.
 * WHY: Reassignments happen often (theodrum → astellarkitty in art-0910;
 *      multiple swaps in art-0065). Without this command, staff have to
 *      remember the right sequence of $remove / $add / queue moves and the
 *      channel name doesn't reflect reality.
 *
 * FLOW: Slash → resolve current artist → ephemeral preview embed with
 *       Confirm/Cancel buttons → on Confirm: TicketService.reassignArtist
 *       (Discord perms + close prior job) → insert new art_job linked to
 *       ticket → post visible embed in channel.
 *
 * PERMISSIONS: ManageRoles OR Community Ambassador OR Mod Team.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import {
  COMMUNITY_AMBASSADOR_ROLE_ID,
  MOD_TEAM_ROLE_ID,
} from "../features/tickets/config.js";
import { TicketService } from "../features/tickets/service.js";
import { createJob } from "../features/artJobs/index.js";
import { logAssignment } from "../features/artistRotation/index.js";
import { db } from "../db/db.js";
import type { ArtType } from "../features/artistRotation/index.js";

const ARTIST_TYPE_KEYS = new Set([
  "art-redeem",
  "2d-artist",
  "3d-artist",
  "music-creator",
  "fursuit-creator",
]);

export const ASSIGN_CONFIRM_PREFIX = "tk:asncf:";
export const ASSIGN_CANCEL_PREFIX = "tk:asncx:";

export const data = new SlashCommandBuilder()
  .setName("assignticket")
  .setDescription("Manually reassign the artist on an art ticket.")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("The ticket channel to reassign.")
      .setRequired(true)
  )
  .addUserOption((opt) =>
    opt
      .setName("artist")
      .setDescription("The new artist to assign.")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false);

function actorIsStaff(member: GuildMember | null): boolean {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    member.roles.cache.has(COMMUNITY_AMBASSADOR_ROLE_ID) ||
    member.roles.cache.has(MOD_TEAM_ROLE_ID)
  );
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Run inside a guild.", flags: MessageFlags.Ephemeral });
    return;
  }
  const member = interaction.member as GuildMember;
  if (!actorIsStaff(member)) {
    await interaction.reply({
      content: "Only Community Ambassadors / Mod Team / users with ManageRoles can reassign tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  const newArtist = interaction.options.getUser("artist", true);

  const ticket = TicketService.findByChannelId(channel.id);
  if (!ticket) {
    await interaction.reply({
      content: `<#${channel.id}> is not a tracked first-party ticket. /assignticket only works on tickets created by our system.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (ticket.legacySource !== null) {
    await interaction.reply({
      content: `<#${channel.id}> is a legacy Ticket Tool channel (legacy_source=${ticket.legacySource}). Use \$add / \$remove on it instead.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!ARTIST_TYPE_KEYS.has(ticket.typeKey)) {
    await interaction.reply({
      content: `Tickets of type \`${ticket.typeKey}\` don't carry an assigned artist.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (ticket.status === "closed") {
    await interaction.reply({
      content: "This ticket is already closed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentArtistId = TicketService.getCurrentArtistId(ticket.id);
  if (currentArtistId === newArtist.id) {
    await interaction.reply({
      content: `<@${newArtist.id}> is already assigned to this ticket.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const preview = new EmbedBuilder()
    .setTitle("Confirm artist reassignment")
    .setColor(0xfeb800)
    .setDescription(
      [
        `**Channel:** <#${channel.id}>`,
        `**Type:** \`${ticket.typeKey}\``,
        `**From:** ${currentArtistId ? `<@${currentArtistId}>` : "*nobody (no prior assignment)*"}`,
        `**To:** <@${newArtist.id}>`,
        "",
        "This will revoke the previous artist's channel access, grant the new artist, close the prior art_job, create a new one, and rename the channel.",
      ].join("\n")
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ASSIGN_CONFIRM_PREFIX}${ticket.id}:${newArtist.id}`)
      .setLabel("Confirm reassign")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${ASSIGN_CANCEL_PREFIX}${ticket.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [preview],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Confirm-button handler for the two-step flow. customId format:
 *   tk:asncf:<ticketId>:<newArtistId>
 *
 * On click: actor permission re-check, then run reassignArtist + createJob +
 * logAssignment (override=1 since manual reassignment is corrective, not
 * rotational — the queue is NOT advanced).
 */
export async function handleAssignConfirm(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Run inside a guild.", flags: MessageFlags.Ephemeral });
    return;
  }
  const member = interaction.member as GuildMember;
  if (!actorIsStaff(member)) {
    await interaction.reply({
      content: "Permission lost. Action aborted.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rest = interaction.customId.slice(ASSIGN_CONFIRM_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep === -1) {
    await interaction.update({ content: "Bad customId.", embeds: [], components: [] });
    return;
  }
  const ticketId = rest.slice(0, sep);
  const toArtistId = rest.slice(sep + 1);

  const ticket = TicketService.findById(ticketId);
  if (!ticket) {
    await interaction.update({ content: "Ticket no longer exists.", embeds: [], components: [] });
    return;
  }

  const currentArtistId = TicketService.getCurrentArtistId(ticketId);

  await interaction.update({
    content: "Reassigning…",
    embeds: [],
    components: [],
  });

  try {
    await TicketService.reassignArtist(ticketId, {
      fromArtistId: currentArtistId,
      toArtistId,
      actorUserId: interaction.user.id,
      guild: interaction.guild,
    });

    // For art-redeem tickets (the rotation flow), also drop a logAssignment row
    // with override=1 and create the new art_job linked by ticket_id. The
    // art type is inherited from the prior art_job on this ticket — without
    // a prior, /redeemreward must run first; we skip the audit/job inserts
    // and report success of the Discord side only.
    if (ticket.typeKey === "art-redeem") {
      const priorJob = db
        .prepare(
          `SELECT ticket_type FROM art_job
             WHERE ticket_id = ?
             ORDER BY assigned_at DESC LIMIT 1`
        )
        .get(ticket.id) as { ticket_type: string } | undefined;
      const inheritedType = priorJob?.ticket_type as ArtType | undefined;

      if (inheritedType) {
        logAssignment({
          guildId: ticket.guildId,
          artistId: toArtistId,
          recipientId: ticket.openerUserId,
          ticketType: inheritedType,
          ticketRoleId: null,
          assignedBy: interaction.user.id,
          channelId: ticket.channelId,
          override: true,
        });
        try {
          const job = createJob({
            guildId: ticket.guildId,
            artistId: toArtistId,
            recipientId: ticket.openerUserId,
            ticketType: inheritedType,
            ticketId: ticket.id,
          });
          await interaction.editReply({
            content: `Reassigned. Job #${String(job.jobNumber).padStart(4, "0")} created for <@${toArtistId}>.`,
          });
          return;
        } catch (err) {
          logger.warn(
            { err, ticketId },
            "[assignticket] createJob after reassign failed; reassign itself succeeded"
          );
        }
      } else {
        logger.info(
          { ticketId },
          "[assignticket] no prior art_job to inherit type from; skipping log/job creation"
        );
      }
    }

    await interaction.editReply({ content: `Reassigned to <@${toArtistId}>.` });
  } catch (err) {
    logger.error({ err, ticketId, toArtistId }, "[assignticket] reassignment failed");
    await interaction.editReply({
      content: `Failed: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }
}

/** Cancel-button handler. customId format: tk:asncx:<ticketId> */
export async function handleAssignCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: "Cancelled.",
    embeds: [],
    components: [],
  });
}
