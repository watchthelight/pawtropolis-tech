/**
 * Pawtropolis Tech — src/features/report/index.ts
 * WHAT: Content report system for ambassador rule violation reports.
 * WHY: Allows ambassadors to report content violations with screenshot evidence.
 * FLOWS:
 *  - Ambassador uses /report → creates forum thread → staff resolves
 *  - Thread contains embed with reporter info, target user, and evidence
 *  - Staff clicks Resolve → modal for optional note → thread archived
 * DOCS:
 *  - Forum channels: https://discord.js.org/#/docs/discord.js/main/class/ForumChannel
 *  - Threads: https://discord.js.org/#/docs/discord.js/main/class/ThreadChannel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ForumChannel,
  type Guild,
  ChannelType,
} from "discord.js";
import { getConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { shortCode } from "../../lib/ids.js";
import type { ReportData, ReportResult } from "./types.js";

// Colors for report embeds
const COLOR_PENDING = 0xF5A623; // Orange for unresolved
const COLOR_RESOLVED = 0x2ECC71; // Green for resolved

/**
 * Generate a unique report code from reporter ID and timestamp.
 * Not guaranteed unique but collisions are rare for this use case.
 */
export function generateReportCode(reporterId: string): string {
  const input = `${reporterId}-${Date.now()}`;
  return shortCode(input);
}

/**
 * Build the report embed for display in the forum thread.
 * Shows reporter, target, reason, and awaiting resolution status.
 */
export function buildReportEmbed(data: ReportData): EmbedBuilder {
  const now = new Date();

  return new EmbedBuilder()
    .setTitle("Content Report")
    .setColor(COLOR_PENDING)
    .addFields(
      {
        name: "Reporter",
        value: `<@${data.reporter.id}>`,
        inline: true,
      },
      {
        name: "Reported User",
        value: `<@${data.target.id}> (ID: ${data.target.id})`,
        inline: true,
      },
      {
        name: "Reason",
        value: data.reason.length > 1000
          ? data.reason.slice(0, 997) + "..."
          : data.reason,
        inline: false,
      }
    )
    .setFooter({ text: `Report #${data.code}` })
    .setTimestamp(now);
}

/**
 * Build the resolved version of the embed.
 * Changes color to green and adds resolution info.
 */
export function buildResolvedEmbed(
  originalEmbed: EmbedBuilder,
  resolvedBy: string,
  note?: string
): EmbedBuilder {
  const embed = EmbedBuilder.from(originalEmbed.toJSON())
    .setTitle("Content Report (Resolved)")
    .setColor(COLOR_RESOLVED);

  // Add resolution field
  const fields = embed.data.fields || [];
  fields.push({
    name: "Resolved by",
    value: note
      ? `<@${resolvedBy}>\n\n**Note:** ${note}`
      : `<@${resolvedBy}>`,
    inline: false,
  });

  return embed.setFields(fields);
}

/**
 * Build the action row with the Resolve button.
 * Button is disabled after resolution.
 */
export function buildReportActionRow(code: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`v1:report:resolve:${code}`)
      .setLabel("Resolve")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

/**
 * Create a report thread in the configured forum channel.
 * Posts embed + screenshot as the thread starter.
 */
export async function createReportThread(
  guild: Guild,
  data: ReportData
): Promise<ReportResult> {
  // Get forum channel ID from config
  const config = getConfig(data.guildId);
  if (!config?.report_forum_id) {
    return {
      success: false,
      error: "Report forum not configured. Run `/config set report_forum` first.",
    };
  }

  // Fetch the forum channel
  let forum: ForumChannel;
  try {
    const channel = await guild.channels.fetch(config.report_forum_id);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      return {
        success: false,
        error: "Configured report channel is not a forum channel.",
      };
    }
    forum = channel as ForumChannel;
  } catch (err) {
    logger.error({ err, channelId: config.report_forum_id }, "[report] Failed to fetch forum channel");
    return {
      success: false,
      error: "Could not access the report forum channel. Check bot permissions.",
    };
  }

  // Build the thread starter message
  const embed = buildReportEmbed(data);
  const actionRow = buildReportActionRow(data.code);

  // Prepare message options
  const messageOptions: {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
    files?: { attachment: string; name: string }[];
  } = {
    embeds: [embed],
    components: [actionRow],
  };

  // Add evidence attachment if provided
  if (data.evidence) {
    messageOptions.files = [
      {
        attachment: data.evidence.url,
        name: data.evidence.name || "evidence.png",
      },
    ];
  }

  // Create the forum thread
  try {
    const targetUsername = data.target.username.slice(0, 30);
    const thread = await forum.threads.create({
      name: `Report #${data.code} - vs ${targetUsername}`,
      message: messageOptions,
    });

    logger.info(
      {
        evt: "report_created",
        code: data.code,
        reporterId: data.reporter.id,
        targetId: data.target.id,
        threadId: thread.id,
        guildId: data.guildId,
      },
      `[report] Created report thread #${data.code}`
    );

    return {
      success: true,
      threadUrl: thread.url,
    };
  } catch (err) {
    logger.error(
      { err, code: data.code, forumId: config.report_forum_id },
      "[report] Failed to create report thread"
    );
    return {
      success: false,
      error: "Failed to create report thread. Check bot permissions in the forum channel.",
    };
  }
}

// Re-export types for convenience
export * from "./types.js";
