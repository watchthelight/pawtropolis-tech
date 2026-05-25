/**
 * Pawtropolis Tech -- src/commands/audit/acknowledge.ts
 * WHAT: /audit acknowledge handler. Marks a single security issue as
 *       intentional so it won't be reported in future audits.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { analyzeSecurityOnly } from "../../features/serverAuditDocs.js";
import { acknowledgeIssue, getAcknowledgedIssues } from "../../store/acknowledgedSecurityStore.js";

export async function executeAcknowledge(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;
  if (!guildId || !guild) return;

  await withStep(ctx, "handle_acknowledge", async () => {
    // Already deferred above

    const issueId = interaction.options.getString("issue", true).toUpperCase();
    const reason = interaction.options.getString("reason") ?? undefined;

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

      // Check if already acknowledged with same hash
      const existing = getAcknowledgedIssues(guildId);
      const existingAck = existing.get(issue.issueKey);
      if (existingAck && existingAck.permissionHash === issue.permissionHash) {
        await interaction.editReply({
          content: `⚠️ Issue \`${issueId}\` is already acknowledged.\n` +
            `**Acknowledged by:** <@${existingAck.acknowledgedBy}>\n` +
            (existingAck.reason ? `**Reason:** ${existingAck.reason}` : ""),
        });
        return;
      }

      // Acknowledge the issue
      acknowledgeIssue({
        guildId,
        issueKey: issue.issueKey,
        severity: issue.severity,
        title: issue.title,
        permissionHash: issue.permissionHash,
        acknowledgedBy: user.id,
        reason,
      });

      const embed = new EmbedBuilder()
        .setTitle("✅ Issue Acknowledged")
        .setColor(0x22C55E)
        .addFields(
          { name: "Issue", value: `[${issue.id}] ${issue.title}`, inline: false },
          { name: "Affected", value: issue.affected, inline: false },
          { name: "Acknowledged by", value: `<@${user.id}>`, inline: true }
        )
        .setTimestamp();

      if (reason) {
        embed.addFields({ name: "Reason", value: reason, inline: false });
      }

      embed.setFooter({ text: "This issue will be marked as acknowledged in future audits." });

      await interaction.editReply({ embeds: [embed] });

      logger.info(
        { userId: user.id, guildId, issueId, issueKey: issue.issueKey, reason },
        "[audit:acknowledge] Issue acknowledged"
      );
    } catch (err) {
      logger.error({ err, userId: user.id, guildId, issueId }, "[audit:acknowledge] Failed to acknowledge");
      await interaction.editReply({
        content: `❌ Failed to acknowledge issue: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
