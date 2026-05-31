/**
 * Pawtropolis Tech -- src/commands/welcomeBatchContext.ts
 * WHAT: USER context menu "Welcome Batch" — right-click toggle for the welcome
 *       batch session.
 * WHY: Lets a Gatekeeper start a batch and queue users by right-clicking, then
 *      send the combined welcome by right-clicking any queued user again. No
 *      slash command required.
 * RULES:
 *  - Right-click a user who is NOT in the batch: add them (auto-start if needed).
 *  - Right-click a user already in the batch: flush the batch and close session.
 *  - Permission gated to Gatekeeper.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  MessageFlags,
  type UserContextMenuCommandInteraction,
  type GuildMember,
  type Client,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { hasRole, ROLE_IDS, shouldBypass, getConfig } from "../lib/config.js";
import {
  addMember,
  isMemberBuffered,
  flushSession,
  getSessionStatus,
  WELCOME_BATCH_MAX_USERS,
  WELCOME_BATCH_EXPIRY_MS,
} from "../features/welcomeBatch.js";

export const welcomeBatchContextMenu = new ContextMenuCommandBuilder()
  .setName("Welcome Batch")
  .setType(ApplicationCommandType.User)
  .setDMPermission(false);

function isGatekeeper(member: GuildMember | null, userId: string): boolean {
  if (shouldBypass(userId, member)) return true;
  return hasRole(member, ROLE_IDS.GATEKEEPER);
}

async function dmExpiryNotice(
  client: Client,
  userId: string,
  guildName: string,
  memberIds: string[]
): Promise<void> {
  try {
    const u = await client.users.fetch(userId);
    const list = memberIds.length > 0 ? memberIds.map((id) => `<@${id}>`).join(", ") : "(none)";
    await u.send(
      `Your welcome batch session in **${guildName}** auto-expired after 30 minutes of inactivity. ` +
        `**${memberIds.length}** buffered welcome(s) were discarded: ${list}.`
    );
  } catch (err) {
    logger.warn({ err, userId }, "[welcomeBatch] failed to DM session opener about expiry");
  }
}

export async function handleWelcomeBatchContextMenu(
  interaction: UserContextMenuCommandInteraction
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction
      .reply({ content: "Guild only.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  const guild = interaction.guild;
  const member = interaction.member as GuildMember | null;
  if (!isGatekeeper(member, interaction.user.id)) {
    await interaction
      .reply({
        content: "You do not have the Gatekeeper role required for the welcome batch.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  await interaction
    .deferReply({ flags: MessageFlags.Ephemeral })
    .catch((err) => {
      logger.debug({ err, interactionId: interaction.id }, "[welcomeBatchContext] deferReply failed");
    });

  // Resolve the target as a GuildMember. The bot needs the member for the
  // welcome card render, not just a User.
  let target: GuildMember | null = null;
  try {
    target = interaction.targetMember instanceof Object
      ? (interaction.targetMember as GuildMember)
      : null;
    if (!target || !("id" in target)) {
      target = await guild.members.fetch(interaction.targetId);
    }
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id, targetId: interaction.targetId },
      "[welcomeBatchContext] failed to resolve target member"
    );
    await interaction.editReply({
      content: "Could not resolve that user as a guild member.",
    });
    return;
  }
  if (!target) {
    await interaction.editReply({
      content: "Could not resolve that user as a guild member.",
    });
    return;
  }

  // Toggle semantics: if the target is already buffered, treat the right-click as
  // "send and close the batch". Otherwise add (auto-start if no session yet).
  if (isMemberBuffered(guild.id, target.id)) {
    // Only the gatekeeper who opened the session may send/close it. addMember already
    // blocks cross-opener adds; without this, another gatekeeper could prematurely
    // flush an in-progress batch by right-clicking a queued user.
    const sessionOwner = getSessionStatus(guild.id).openedBy;
    if (
      sessionOwner &&
      sessionOwner !== interaction.user.id &&
      !shouldBypass(interaction.user.id, member)
    ) {
      await interaction.editReply({
        content: `This batch session is owned by <@${sessionOwner}>. Ask them to send or cancel it.`,
      });
      return;
    }
    const cfg = getConfig(guild.id);
    if (!cfg) {
      await interaction.editReply({ content: "Guild not configured." });
      return;
    }
    if (!cfg.general_channel_id) {
      await interaction.editReply({
        content:
          "Cannot send: general channel not configured. Use `/welcomebatch cancel` to discard the queue.",
      });
      return;
    }
    const flush = await flushSession(guild, cfg);
    if (flush.kind === "no_session") {
      await interaction.editReply({ content: "Batch session disappeared before sending." });
      return;
    }
    if (flush.kind === "empty") {
      await interaction.editReply({ content: "Session closed — nothing was queued." });
      return;
    }
    if (flush.kind === "error") {
      await interaction.editReply({
        content: `Failed to send batch welcome (${flush.userCount} user(s)): ${flush.error}`,
      });
      return;
    }
    await interaction.editReply({
      content: `Sent batch welcome for **${flush.userCount}** user(s) in <#${cfg.general_channel_id}>.`,
    });
    return;
  }

  const result = addMember(target, interaction.user.id, ({ openedBy, memberIds }) => {
    void dmExpiryNotice(interaction.client, openedBy, guild.name, memberIds);
  });

  if (result.kind === "denied_other_opener") {
    await interaction.editReply({
      content: `A batch session is already open by <@${result.openedBy}>. Ask them to send or cancel it before starting yours.`,
    });
    return;
  }
  if (result.kind === "full") {
    await interaction.editReply({
      content: `Batch is full (${WELCOME_BATCH_MAX_USERS} max). Right-click any queued user to send.`,
    });
    return;
  }
  if (result.kind === "already_buffered") {
    await interaction.editReply({
      content: `<@${target.id}> is already in the batch (${result.bufferedCount}/${WELCOME_BATCH_MAX_USERS}).`,
    });
    return;
  }

  const minutes = Math.round(WELCOME_BATCH_EXPIRY_MS / 60000);
  if (result.kind === "started") {
    await interaction.editReply({
      content:
        `Batch started — queued <@${target.id}> (${result.bufferedCount}/${WELCOME_BATCH_MAX_USERS}).\n` +
        `Right-click any queued user and pick **Welcome Batch** again to send. Auto-expires after ${minutes} min.`,
    });
    return;
  }

  // kind === "added"
  await interaction.editReply({
    content: `Queued <@${target.id}> (${result.bufferedCount}/${WELCOME_BATCH_MAX_USERS}). Right-click a queued user and pick **Welcome Batch** again to send.`,
  });
}
