/**
 * Pawtropolis Tech — src/features/artistRotation/handlers.ts
 * WHAT: Button interaction handlers for /redeemreward confirmation flow.
 * WHY: Handle confirm/cancel buttons, execute assignment, send Ticket Tool command.
 * FLOWS:
 *  - Confirm → Remove ticket role → Send $add command → Move artist to end → Log
 *  - Cancel → Dismiss message
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ButtonInteraction, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getTicketRoles,
  TICKET_ROLE_NAMES,
  ART_TYPE_DISPLAY,
  type ArtType,
  incrementAssignments,
  logAssignment,
  getArtist,
  getAllArtists,
  processAssignment,
} from "./index.js";
import { createJob } from "../artJobs/index.js";
import { TicketService } from "../tickets/service.js";
import { recordArtTicketRedemption } from "../patreonArtRewards.js";
import { db } from "../../db/db.js";

/*
 * Parse redeemreward button customId
 * Format: redeemreward:{confirmId}:confirm:{recipientId}:{artType}:{artistId}:{isOverride}
 * Or: redeemreward:{confirmId}:cancel
 *
 * GOTCHA: This format is packed tight because Discord customIds have a 100-char limit.
 * Don't add more fields without checking you haven't blown past it.
 */
function parseCustomId(customId: string) {
  const parts = customId.split(":");
  if (parts.length < 3 || parts[0] !== "redeemreward") {
    return null;
  }

  const confirmId = parts[1];
  const action = parts[2];

  if (action === "cancel") {
    return { confirmId, action: "cancel" as const };
  }

  if (action === "confirm" && parts.length >= 7) {
    return {
      confirmId: confirmId!,
      action: "confirm" as const,
      recipientId: parts[3]!,
      artType: parts[4] as ArtType,
      artistId: parts[5]!,
      isOverride: parts[6] === "1",
    };
  }

  return null;
}

/**
 * Handle redeemreward button interactions
 */
export async function handleRedeemRewardButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId);

  if (!parsed) {
    // Someone is either tampering with requests or we deployed a breaking change.
    // Either way, the user gets a cryptic error. Such is life.
    logger.warn({ customId: interaction.customId }, "[redeemreward] Invalid button customId");
    await interaction.reply({ content: "Invalid button." });
    return;
  }

  if (parsed.action === "cancel") {
    await handleCancel(interaction);
    return;
  }

  if (parsed.action === "confirm") {
    await handleConfirm(interaction, parsed);
    return;
  }
}

/**
 * Handle cancel button
 */
async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: "Redemption cancelled.",
    embeds: [],
    components: [],
  });
}

/**
 * Handle confirm button
 */
async function handleConfirm(
  interaction: ButtonInteraction,
  data: {
    confirmId: string;
    recipientId: string;
    artType: ArtType;
    artistId: string;
    isOverride: boolean;
  }
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This must be done in a server." });
    return;
  }

  // deferUpdate buys us 15 minutes instead of 3 seconds. We need it because
  // Discord API calls for role removal and message sends add up.
  await interaction.deferUpdate();

  // Reentrancy guard. The confirmation is a shared, non-ephemeral message, so a
  // double-click (or two staff) produces distinct interactions that would each
  // rotate the artist queue and create a duplicate art_job. Atomically consume
  // the confirmId; only the first click wins. Must run before any side effect.
  const consumed = db
    .prepare(`INSERT OR IGNORE INTO consumed_confirmations (confirm_id) VALUES (?)`)
    .run(data.confirmId);
  if (consumed.changes === 0) {
    logger.info(
      { confirmId: data.confirmId, recipientId: data.recipientId, artistId: data.artistId },
      "[redeemreward] duplicate confirm ignored (already processed)"
    );
    await interaction.editReply({ components: [] }).catch(() => undefined);
    return;
  }

  const results: string[] = [];
  let success = true;

  // Step 1: Consume the ticket. The Discord ticket role IS the single-use token,
  // so this is the spend. If we cannot consume it we MUST abort before assigning an
  // artist or creating a job - otherwise a redemption against a user with no ticket,
  // or a second concurrent /redeemreward whose first confirm already removed the
  // role, would still produce a duplicate assignment + art_job (#00084 / #00075).
  const abort = async (message: string): Promise<void> => {
    await interaction
      .editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Art Reward Not Redeemed")
            .setColor(0xff0000)
            .setDescription(message),
        ],
        components: [],
      })
      .catch(() => undefined);
  };

  const ticketRoles = getTicketRoles(guild.id);
  const ticketRoleId = ticketRoles[data.artType];
  if (!ticketRoleId) {
    logger.warn({ guildId: guild.id, artType: data.artType }, "[redeemreward] no ticket role configured for art type");
    await abort(`No ticket role is configured for **${ART_TYPE_DISPLAY[data.artType]}**. Nothing was redeemed.`);
    return;
  }

  let recipientMember;
  try {
    recipientMember = await guild.members.fetch(data.recipientId);
  } catch (err) {
    logger.warn({ err, recipientId: data.recipientId }, "[redeemreward] could not fetch recipient");
    await abort(`Could not look up <@${data.recipientId}>. Nothing was redeemed.`);
    return;
  }

  if (!recipientMember.roles.cache.has(ticketRoleId)) {
    // No ticket = nothing to spend. Hard-fail instead of silently assigning.
    await abort(
      `<@${data.recipientId}> does not hold a **${ART_TYPE_DISPLAY[data.artType]}** ticket. ` +
        "It may have already been redeemed. Nothing was assigned."
    );
    return;
  }

  try {
    await recipientMember.roles.remove(ticketRoleId);
    const roleName = TICKET_ROLE_NAMES[ticketRoleId] ?? data.artType;
    results.push(`${roleName} role removed from <@${data.recipientId}>`);
    // Count the spend against the Patreon grant ledger (no-op for non-Patreon
    // tickets) so a quantity > 1 tier can have the ticket role re-granted while
    // tickets remain. Best-effort: a ledger hiccup must not fail the redemption.
    try {
      recordArtTicketRedemption(guild.id, data.recipientId, data.artType);
    } catch (err) {
      logger.warn({ err, recipientId: data.recipientId, artType: data.artType }, "[redeemreward] failed to record art ticket redemption");
    }
  } catch (err) {
    logger.warn({ err, recipientId: data.recipientId, roleId: ticketRoleId }, "[redeemreward] Failed to remove ticket role");
    await abort("Failed to remove the ticket role (check bot permissions). Nothing was assigned.");
    return;
  }

  /*
   * Step 2: Add the artist to the ticket channel.
   *
   * Two paths:
   *   a) New first-party tickets (migration 067+): the channel has a tracked
   *      `ticket` row with legacy_source IS NULL. Grant ViewChannel +
   *      SendMessages directly via permission overwrite, then rename the
   *      channel to include the artist's identity (art-NNNN-<artist>). No
   *      Ticket Tool puppeting required.
   *   b) Legacy Ticket Tool channels (the 26 inherited at cutover): no `ticket`
   *      row, OR legacy_source='ticket_tool'. Fall back to sending the
   *      `$add <@artistId>` text command to Ticket Tool — same as before.
   *
   * The branch keeps the legacy path alive until those tickets bleed off
   * naturally; no migration of in-flight conversations.
   */
  const channel = interaction.channel as TextChannel | null;
  let ticketIdForJob: string | null = null;
  if (channel && "send" in channel) {
    const ticket = TicketService.findByChannelId(channel.id);

    if (ticket && ticket.legacySource === null) {
      // Path A: first-party ticket. Grant perms directly, no $add.
      ticketIdForJob = ticket.id;
      try {
        const artistMember = await guild.members.fetch(data.artistId);
        await channel.permissionOverwrites.edit(artistMember, {
          ViewChannel: true,
          SendMessages: true,
          EmbedLinks: true,
          AttachFiles: true,
          ReadMessageHistory: true,
        });
        results.push(`<@${data.artistId}> granted ticket access`);
      } catch (err) {
        logger.warn(
          { err, artistId: data.artistId, ticketId: ticket.id },
          "[redeemreward] direct grant failed on first-party ticket"
        );
        results.push(`Failed to grant artist access`);
        success = false;
      }

      // Rename channel for art-redeem types to include the artist identity.
      if (ticket.typeKey === "art-redeem") {
        try {
          await TicketService.renameForArtist(ticket.id, data.artistId, guild);
        } catch (err) {
          logger.warn({ err, ticketId: ticket.id }, "[redeemreward] rename after assign failed");
        }
      }
    } else {
      // Path B: legacy Ticket Tool channel. Keep puppeting until it closes.
      try {
        await channel.send(`$add <@${data.artistId}>`);
        results.push(`<@${data.artistId}> added to ticket`);
      } catch (err) {
        logger.warn(
          { err, artistId: data.artistId },
          "[redeemreward] Failed to send $add command"
        );
        results.push(`Failed to send $add command`);
        success = false;
      }
    }
  } else {
    results.push(`Could not add artist (not a text channel)`);
    success = false;
  }

  /*
   * Step 3: Update queue (if not override, move artist to end)
   *
   * WHY is override different? Sometimes staff manually picks an artist
   * out of turn. We still want to log it, but we shouldn't penalize
   * the artist's queue position for being popular.
   */
  const artistInfo = getArtist(guild.id, data.artistId);
  const oldPosition = artistInfo?.position ?? null;

  if (!data.isOverride && oldPosition !== null) {
    const result = processAssignment(guild.id, data.artistId);

    if (result) {
      getAllArtists(guild.id);
      results.push(`Artist moved from #${result.oldPosition} to #${result.newPosition} in queue (${result.assignmentsCount} total assignments)`);
    } else {
      results.push(`*Failed to update queue - artist not found*`);
      success = false;
    }
  } else if (data.isOverride) {
    // Still count toward their total even if we didn't rotate them.
    // Stats are stats, even when the rules are bent.
    incrementAssignments(guild.id, data.artistId);
    results.push(`*Override - queue position unchanged*`);
  }

  // Step 4: Log assignment
  logAssignment({
    guildId: guild.id,
    artistId: data.artistId,
    recipientId: data.recipientId,
    ticketType: data.artType,
    ticketRoleId: ticketRoleId ?? null,
    assignedBy: interaction.user.id,
    channelId: channel?.id ?? null,
    override: data.isOverride,
  });
  results.push(`Assignment logged`);

  // Step 5: Create art job for tracking (separate from queue - this is for WIP tracking)
  const job = createJob({
    guildId: guild.id,
    artistId: data.artistId,
    recipientId: data.recipientId,
    ticketType: data.artType,
    ticketId: ticketIdForJob,
  });
  results.push(`Job #${String(job.jobNumber).padStart(4, "0")} created`);

  // Build result embed
  const embed = new EmbedBuilder()
    .setTitle(success ? "Art Reward Assigned" : "Art Reward Assigned (with warnings)")
    .setColor(success ? 0x00cc00 : 0xffaa00)
    .setDescription(
      [
        `**Recipient:** <@${data.recipientId}>`,
        `**Type:** ${ART_TYPE_DISPLAY[data.artType]}`,
        `**Artist:** <@${data.artistId}>`,
        "",
        "**Actions:**",
        ...results.map((r) => `- ${r}`),
      ].join("\n")
    );

  await interaction.editReply({
    embeds: [embed],
    components: [],
  });

  logger.info(
    {
      guildId: guild.id,
      recipientId: data.recipientId,
      artistId: data.artistId,
      artType: data.artType,
      isOverride: data.isOverride,
      assignedBy: interaction.user.id,
      success,
    },
    "[redeemreward] Assignment completed"
  );
}

// Quick prefix check to route button interactions. Used in the event handler
// to avoid parsing every single button click on the server.
export function isRedeemRewardButton(customId: string): boolean {
  return customId.startsWith("redeemreward:");
}
