/**
 * Pawtropolis Tech -- src/commands/audit/unacknowledge.ts
 * WHAT: /audit unacknowledge handler. Removes the acknowledgment from a
 *       single previously-acknowledged security issue.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { analyzeSecurityOnly } from "../../features/serverAuditDocs.js";
import { unacknowledgeIssue, getAcknowledgedIssues } from "../../store/acknowledgedSecurityStore.js";

export async function executeUnacknowledge(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;
  if (!guildId || !guild) return;

  await withStep(ctx, "handle_unacknowledge", async () => {
    // Already deferred above

    const issueId = interaction.options.getString("issue", true).toUpperCase();

    try {
      // Run fresh analysis to get current issues
      const issues = await analyzeSecurityOnly(guild);
      const issue = issues.find((i) => i.id === issueId);

      if (!issue) {
        await interaction.editReply({
          content: `❌ Issue \`${issueId}\` not found. Run \`/audit security\` first to see current issues.`,
        });
        return;
      }

      // Check if acknowledged
      const existing = getAcknowledgedIssues(guildId);
      const existingAck = existing.get(issue.issueKey);
      if (!existingAck) {
        await interaction.editReply({
          content: `⚠️ Issue \`${issueId}\` is not currently acknowledged.`,
        });
        return;
      }

      // Unacknowledge the issue
      const removed = unacknowledgeIssue(guildId, issue.issueKey);

      if (removed) {
        const embed = new EmbedBuilder()
          .setTitle("🔄 Acknowledgment Removed")
          .setColor(0xF59E0B)
          .addFields(
            { name: "Issue", value: `[${issue.id}] ${issue.title}`, inline: false },
            { name: "Affected", value: issue.affected, inline: false },
            { name: "Removed by", value: `<@${user.id}>`, inline: true }
          )
          .setFooter({ text: "This issue will appear in future audits again." })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        logger.info(
          { userId: user.id, guildId, issueId, issueKey: issue.issueKey },
          "[audit:unacknowledge] Acknowledgment removed"
        );
      } else {
        await interaction.editReply({
          content: `⚠️ Could not remove acknowledgment for \`${issueId}\`.`,
        });
      }
    } catch (err) {
      logger.error({ err, userId: user.id, guildId, issueId }, "[audit:unacknowledge] Failed to unacknowledge");
      await interaction.editReply({
        content: `❌ Failed to unacknowledge issue: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
