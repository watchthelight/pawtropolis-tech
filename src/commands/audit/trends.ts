/**
 * Pawtropolis Tech -- src/commands/audit/trends.ts
 * WHAT: /audit trends handler. Compares oldest vs newest issue counts in a
 *       rolling window (1-30 days) and renders the deltas as an embed.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { getIssueHistory } from "../../store/securitySnapshotStore.js";

export async function executeTrends(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;
  if (!guildId || !guild) return;

  await withStep(ctx, "handle_trends", async () => {
    // Already deferred above

    const days = interaction.options.getInteger("days") ?? 7;

    try {
      const history = getIssueHistory(guildId, days);

      if (history.length === 0) {
        await interaction.editReply({
          content: `📊 No audit history found for the past ${days} days. Run \`/audit security\` to start tracking.`,
        });
        return;
      }

      // Build trend data
      const latestEntry = history[0];
      const oldestEntry = history[history.length - 1];

      // Calculate changes
      const criticalChange = latestEntry.criticalCount - oldestEntry.criticalCount;
      const highChange = latestEntry.highCount - oldestEntry.highCount;
      const mediumChange = latestEntry.mediumCount - oldestEntry.mediumCount;
      const lowChange = latestEntry.lowCount - oldestEntry.lowCount;

      const formatChange = (change: number) => {
        if (change > 0) return `↑ +${change}`;
        if (change < 0) return `↓ ${change}`;
        return "→ 0";
      };

      const embed = new EmbedBuilder()
        .setTitle(`📊 Security Audit Trends (${days} days)`)
        .setColor(0x3B82F6)
        .setDescription(`Showing ${history.length} audit records from the past ${days} days.`)
        .addFields(
          {
            name: "Current Issue Counts",
            value: [
              `🔴 Critical: ${latestEntry.criticalCount} (${formatChange(criticalChange)})`,
              `🟠 High: ${latestEntry.highCount} (${formatChange(highChange)})`,
              `🟡 Medium: ${latestEntry.mediumCount} (${formatChange(mediumChange)})`,
              `🟢 Low: ${latestEntry.lowCount} (${formatChange(lowChange)})`,
              `✅ Acknowledged: ${latestEntry.acknowledgedCount}`,
            ].join("\n"),
            inline: false,
          },
          {
            name: "Issue Categories",
            value: [
              `Roles: ${latestEntry.roleIssues}`,
              `Channels: ${latestEntry.channelIssues}`,
              `Hierarchy: ${latestEntry.hierarchyIssues}`,
              `Verification: ${latestEntry.verificationIssues}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Audit Range",
            value: [
              `First: <t:${oldestEntry.recordedAt}:R>`,
              `Latest: <t:${latestEntry.recordedAt}:R>`,
            ].join("\n"),
            inline: true,
          }
        )
        .setFooter({ text: "Run /audit security to refresh data" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logger.info(
        { userId: user.id, guildId, days, recordCount: history.length },
        "[audit:trends] Trends displayed"
      );
    } catch (err) {
      logger.error({ err, userId: user.id, guildId }, "[audit:trends] Failed to get trends");
      await interaction.editReply({
        content: `❌ Failed to fetch trends: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
