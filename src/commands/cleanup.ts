// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/cleanup.ts
 * WHAT: /cleanup count:N — purge up to N (max 1000) recent messages from the channel
 * WHY: Quick mod hygiene tool when a thread floods or spam needs sweeping
 * FLOWS:
 *  - bulkDelete in batches of 100 (Discord limit)
 *  - 14-day filter applied automatically by bulkDelete{filterOld:true}
 *  - Older messages reported as skipped, not deleted (Discord won't bulk-delete >14d)
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  type GuildTextBasedChannel,
} from "discord.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { requireMinRole, ROLE_IDS } from "../lib/config.js";

const MAX_PURGE = 1000;
const BATCH_SIZE = 100;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName("cleanup")
  .setDescription("Purge up to 1000 recent messages from this channel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addIntegerOption((opt) =>
    opt
      .setName("count")
      .setDescription(`How many messages to purge (1–${MAX_PURGE}).`)
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_PURGE)
  )
  .addStringOption((opt) =>
    opt
      .setName("reason")
      .setDescription("Reason logged to the audit channel.")
      .setMaxLength(200)
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;

  if (!interaction.guild) {
    await interaction.reply({ content: "Guild only.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Mod or higher; requireMinRole handles bypass list + ephemeral denial reply
  if (!requireMinRole(interaction, ROLE_IDS.MODERATOR)) return;

  const channel = interaction.channel;
  if (!channel || !("bulkDelete" in channel)) {
    await interaction.reply({
      content: "This channel does not support bulk-delete (e.g. DM or voice).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Discord forbids bulk-delete in announcement crossposts and a few exotic types — guard.
  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement &&
    channel.type !== ChannelType.PublicThread &&
    channel.type !== ChannelType.PrivateThread &&
    channel.type !== ChannelType.AnnouncementThread &&
    channel.type !== ChannelType.GuildVoice &&
    channel.type !== ChannelType.GuildStageVoice
  ) {
    await interaction.reply({
      content: `Channel type ${channel.type} is not supported for /cleanup.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const requested = interaction.options.getInteger("count", true);
  const count = Math.max(1, Math.min(MAX_PURGE, requested));
  const reason = interaction.options.getString("reason") ?? null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let deleted = 0;
  let skippedOld = 0;
  let remaining = count;
  const cutoff = Date.now() - TWO_WEEKS_MS;
  const textChannel = channel as GuildTextBasedChannel;

  try {
    while (remaining > 0) {
      const fetchSize = Math.min(BATCH_SIZE, remaining);
      const fetched = await textChannel.messages.fetch({ limit: fetchSize });
      if (fetched.size === 0) break;

      // Partition by age. Messages older than 14d cannot be bulk-deleted by Discord.
      const fresh = fetched.filter((m) => m.createdTimestamp > cutoff);
      const stale = fetched.filter((m) => m.createdTimestamp <= cutoff);
      skippedOld += stale.size;

      if (fresh.size === 0) {
        // Nothing more we can purge in this batch — older messages would block progress.
        break;
      }

      // bulkDelete with filterOld=true skips anything stale we may have missed.
      const result = await textChannel.bulkDelete(fresh, true);
      deleted += result.size;
      remaining -= fetched.size;

      // If we got fewer than asked and nothing fresh remains, we're done early.
      if (fetched.size < fetchSize) break;
    }

    const lines = [
      `Purged **${deleted}** message${deleted === 1 ? "" : "s"} from <#${channel.id}>.`,
    ];
    if (skippedOld > 0) lines.push(`Skipped **${skippedOld}** older than 14 days (Discord limit).`);
    if (reason) lines.push(`Reason: ${reason}`);

    await interaction.editReply({ content: lines.join("\n") });

    logger.info(
      { guildId: interaction.guild.id, channelId: channel.id, actorId: interaction.user.id, deleted, skippedOld, reason },
      "[cleanup] purge complete"
    );

    await logActionPretty(interaction.guild, {
      actorId: interaction.user.id,
      action: "message_purge",
      reason: `Purged ${deleted} messages in #${("name" in channel ? channel.name : channel.id) ?? channel.id}${reason ? ` — ${reason}` : ""}`,
      meta: { channelId: channel.id, deleted, skippedOld, requested: count },
    });
  } catch (err) {
    logger.error(
      { err, guildId: interaction.guild.id, channelId: channel.id },
      "[cleanup] purge failed"
    );
    await interaction.editReply({
      content: `Purge failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
