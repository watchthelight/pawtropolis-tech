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
  if (
    !requireMinRole(interaction, ROLE_IDS.MODERATOR, {
      command: "cleanup",
      description: "Bulk-delete recent messages in this channel.",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.MODERATOR }],
    })
  ) {
    return;
  }

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

  let bulkDeleted = 0;
  let oneByOneDeleted = 0;
  let remaining = count;
  let lastFetchedId: string | undefined;
  const cutoff = Date.now() - TWO_WEEKS_MS;
  const textChannel = channel as GuildTextBasedChannel;

  try {
    while (remaining > 0) {
      const fetchSize = Math.min(BATCH_SIZE, remaining);
      const fetched = await textChannel.messages.fetch({
        limit: fetchSize,
        before: lastFetchedId,
      });
      if (fetched.size === 0) break;
      lastFetchedId = fetched.last()?.id;

      // Bulk-delete the fresh ones (Discord forbids bulkDelete >14d).
      const fresh = fetched.filter((m) => m.createdTimestamp > cutoff);
      const stale = fetched.filter((m) => m.createdTimestamp <= cutoff);

      if (fresh.size > 0) {
        const result = await textChannel.bulkDelete(fresh, true);
        bulkDeleted += result.size;
      }

      // Fall back to one-by-one delete for stale messages so the requested
      // count is honoured even on quiet channels where everything is old.
      // Rate-limited: 5 deletes/sec is the Discord-safe ceiling for individual
      // message deletes; sleep 250ms between to stay well clear.
      for (const m of stale.values()) {
        try {
          await m.delete();
          oneByOneDeleted++;
        } catch {
          // Permission / message-already-gone errors are non-fatal — keep going.
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      remaining -= fetched.size;
      // If Discord returned fewer than asked, no more messages to fetch.
      if (fetched.size < fetchSize) break;
    }

    const total = bulkDeleted + oneByOneDeleted;
    const lines = [
      `Purged **${total}** message${total === 1 ? "" : "s"} from <#${channel.id}>.`,
    ];
    if (oneByOneDeleted > 0) {
      lines.push(`Of those, **${oneByOneDeleted}** were older than 14 days and deleted individually (slower).`);
    }
    if (reason) lines.push(`Reason: ${reason}`);

    await interaction.editReply({ content: lines.join("\n") });

    const deleted = total;
    const skippedOld = 0;

    logger.info(
      { guildId: interaction.guild.id, channelId: channel.id, actorId: interaction.user.id, deleted, skippedOld, reason },
      "[cleanup] purge complete"
    );

    // After the early-return for unsupported channel types above, TS narrows
    // `channel` to `never` because the union of types we accepted does not
    // overlap with the type guards above. Cast to a structurally-typed
    // accessor so we can read `name` (text channels and threads) or fall
    // back to id (voice/stage where `name` may not be present at type level).
    const channelDesc = channel as { id: string; name?: string };
    await logActionPretty(interaction.guild, {
      actorId: interaction.user.id,
      action: "message_purge",
      reason: `Purged ${deleted} messages in #${channelDesc.name ?? channelDesc.id}${reason ? ` — ${reason}` : ""}`,
      meta: { channelId: channelDesc.id, deleted, skippedOld, requested: count },
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
