/**
 * Pawtropolis Tech -- src/commands/postticketpanel.ts
 * WHAT: Admin slash command that posts (or edits in place) the two ticket panel
 *       embeds in the configured panel channel. Idempotent.
 * WHY: Cutover replacement for Ticket Tool's panel messages. Run once after
 *      deploy; re-run to refresh after type registry changes.
 *
 * PERMISSIONS: ManageGuild — only server admins / community managers should
 * have this. The handler also re-checks at runtime in case Discord client-side
 * cache is stale.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { getPanelChannelId } from "../features/tickets/config.js";
import { buildAllPanels, isPanelMessage } from "../features/tickets/panels.js";

export const data = new SlashCommandBuilder()
  .setName("postticketpanel")
  .setDescription("Post or refresh the ticket-system panel embeds.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  if (!interaction.guild) {
    await interaction.reply({
      content: "Run inside a guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "You need ManageGuild to run this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const panelChannelId = getPanelChannelId(interaction.guild.id);
  if (!panelChannelId) {
    await interaction.reply({
      content:
        "No panel channel configured for this guild. Set TICKETS_PANEL_CHANNEL_ID env var or add a guild_config entry.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let channel: TextChannel | null = null;
  try {
    const fetched = await interaction.guild.channels.fetch(panelChannelId);
    if (fetched && fetched.type === ChannelType.GuildText) {
      channel = fetched as TextChannel;
    }
  } catch (err) {
    logger.error({ err, panelChannelId }, "[postticketpanel] failed to fetch panel channel");
  }
  if (!channel) {
    await interaction.editReply({
      content: `Panel channel <#${panelChannelId}> not found or not a text channel.`,
    });
    return;
  }

  const panels = buildAllPanels();

  // Discover existing panel messages by footer marker. Scan the most recent 50
  // messages — panels are pinned-style content near the top of the channel.
  let existingByStack = new Map<string, string>();
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    for (const [, msg] of recent) {
      if (msg.author.id !== interaction.client.user?.id) continue;
      for (const embed of msg.embeds) {
        const stack = isPanelMessage(embed.footer?.text);
        if (stack && !existingByStack.has(stack)) {
          existingByStack.set(stack, msg.id);
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "[postticketpanel] message fetch failed; will post fresh");
  }

  const summary: string[] = [];
  for (const panel of panels) {
    const existingId = existingByStack.get(panel.stack);
    try {
      if (existingId) {
        const existingMsg = await channel.messages.fetch(existingId);
        await existingMsg.edit({
          embeds: panel.embeds,
          components: panel.components,
        });
        summary.push(`✓ ${panel.stack}: edited existing message`);
      } else {
        await channel.send({
          embeds: panel.embeds,
          components: panel.components,
          allowedMentions: { parse: [] },
        });
        summary.push(`✓ ${panel.stack}: posted fresh`);
      }
    } catch (err) {
      logger.error(
        { err, stack: panel.stack },
        "[postticketpanel] failed to post/edit panel"
      );
      summary.push(`✗ ${panel.stack}: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  await interaction.editReply({
    content: `Panel sync result for <#${panelChannelId}>:\n${summary.join("\n")}`,
  });
}
