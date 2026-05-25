/**
 * Pawtropolis Tech -- src/commands/audit/acknowledgeAll.ts
 * WHAT: /audit acknowledge-all handler. Bulk-acknowledges every security
 *       issue at a chosen severity level, skipping ones already acked
 *       with the same permission hash.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { analyzeSecurityOnly } from "../../features/serverAuditDocs.js";
import { acknowledgeIssue, getAcknowledgedIssues } from "../../store/acknowledgedSecurityStore.js";

export async function executeAcknowledgeAll(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;
  if (!guildId || !guild) return;

  await withStep(ctx, "handle_acknowledge_all", async () => {
    // Already deferred above

    const severityFilter = interaction.options.getString("severity", true).toUpperCase();
    const reason = interaction.options.getString("reason") ?? undefined;

    try {
      // Run fresh analysis to get current issues
      const issues = await analyzeSecurityOnly(guild);
      const existingAcks = getAcknowledgedIssues(guildId);

      // Filter issues by severity
      const targetIssues = issues.filter((issue) => {
        if (severityFilter === "ALL") return true;
        return issue.severity === severityFilter;
      });

      if (targetIssues.length === 0) {
        await interaction.editReply({
          content: `⚠️ No ${severityFilter === "ALL" ? "" : severityFilter + " severity "}issues found to acknowledge.`,
        });
        return;
      }

      // Filter out already-acknowledged issues (with same hash)
      const toAcknowledge = targetIssues.filter((issue) => {
        const existingAck = existingAcks.get(issue.issueKey);
        return !existingAck || existingAck.permissionHash !== issue.permissionHash;
      });

      if (toAcknowledge.length === 0) {
        await interaction.editReply({
          content: `✅ All ${targetIssues.length} ${severityFilter === "ALL" ? "" : severityFilter + " severity "}issue(s) are already acknowledged.`,
        });
        return;
      }

      // Acknowledge all matching issues
      let acknowledged = 0;
      for (const issue of toAcknowledge) {
        acknowledgeIssue({
          guildId,
          issueKey: issue.issueKey,
          severity: issue.severity,
          title: issue.title,
          permissionHash: issue.permissionHash,
          acknowledgedBy: user.id,
          reason,
        });
        acknowledged++;
      }

      // Build summary by severity
      const bySeverity = toAcknowledge.reduce((acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const severityBreakdown = Object.entries(bySeverity)
        .map(([sev, count]) => `${sev}: ${count}`)
        .join(", ");

      const embed = new EmbedBuilder()
        .setTitle("✅ Bulk Acknowledgment Complete")
        .setColor(0x22C55E)
        .addFields(
          { name: "Issues Acknowledged", value: `${acknowledged} issue(s)`, inline: true },
          { name: "Severity Filter", value: severityFilter === "ALL" ? "All" : severityFilter, inline: true },
          { name: "Breakdown", value: severityBreakdown || "None", inline: false },
          { name: "Acknowledged by", value: `<@${user.id}>`, inline: true }
        )
        .setTimestamp();

      if (reason) {
        embed.addFields({ name: "Reason", value: reason, inline: false });
      }

      const alreadyAcked = targetIssues.length - toAcknowledge.length;
      if (alreadyAcked > 0) {
        embed.setFooter({ text: `${alreadyAcked} issue(s) were already acknowledged and skipped.` });
      } else {
        embed.setFooter({ text: "These issues will be marked as acknowledged in future audits." });
      }

      await interaction.editReply({ embeds: [embed] });

      logger.info(
        { userId: user.id, guildId, severityFilter, acknowledged, reason },
        "[audit:acknowledge-all] Bulk acknowledgment complete"
      );
    } catch (err) {
      logger.error({ err, userId: user.id, guildId, severityFilter }, "[audit:acknowledge-all] Failed to bulk acknowledge");
      await interaction.editReply({
        content: `❌ Failed to acknowledge issues: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
