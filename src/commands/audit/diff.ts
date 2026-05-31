/**
 * Pawtropolis Tech -- src/commands/audit/diff.ts
 * WHAT: /audit diff handler. Compares the latest two snapshots and renders
 *       added/removed/modified roles, channels, and security issues.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { getSnapshotHistory } from "../../store/securitySnapshotStore.js";
import {
  computeSnapshotDiff,
  getDangerousChanges,
  hasMeaningfulChanges,
} from "../../features/securityDiff.js";

export async function executeDiff(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;
  if (!guildId || !guild) return;

  await withStep(ctx, "handle_diff", async () => {
    // Already deferred above

    try {
      const snapshots = getSnapshotHistory(guildId, 2);

      if (snapshots.length < 2) {
        await interaction.editReply({
          content: `📊 Need at least 2 audit snapshots to show diff. Run \`/audit security\` twice to start tracking changes.`,
        });
        return;
      }

      const newSnapshot = snapshots[0]!;
      const oldSnapshot = snapshots[1]!;
      const diff = computeSnapshotDiff(oldSnapshot, newSnapshot);
      const dangerousChanges = getDangerousChanges(diff);

      if (!hasMeaningfulChanges(diff)) {
        await interaction.editReply({
          content: `✅ No permission changes detected between the last two audits.`,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("🔄 Permission Changes Since Last Audit")
        .setColor(dangerousChanges.length > 0 ? 0xFF4500 : 0x3B82F6)
        .setDescription(
          `Comparing audit from <t:${oldSnapshot.createdAt}:R> to <t:${newSnapshot.createdAt}:R>`
        )
        .addFields(
          {
            name: "Role Changes",
            value: [
              `Added: ${diff.rolesAdded.length}`,
              `Removed: ${diff.rolesRemoved.length}`,
              `Modified: ${diff.rolesChanged.length}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Channel Changes",
            value: [
              `Added: ${diff.channelsAdded.length}`,
              `Removed: ${diff.channelsRemoved.length}`,
              `Modified: ${diff.channelsChanged.length}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Issue Changes",
            value: [
              `New: ${diff.issuesNew.length}`,
              `Resolved: ${diff.issuesResolved.length}`,
            ].join("\n"),
            inline: true,
          }
        )
        .setTimestamp();

      // Add dangerous changes if any
      if (dangerousChanges.length > 0) {
        const dangerousSummary = dangerousChanges
          .slice(0, 5)
          .map((c) => {
            const emoji = c.severity === "critical" ? "🔴" : c.severity === "high" ? "🟠" : "🟡";
            return `${emoji} ${c.description}`;
          })
          .join("\n");

        embed.addFields({
          name: `⚠️ Dangerous Changes (${dangerousChanges.length})`,
          value: dangerousSummary + (dangerousChanges.length > 5 ? `\n...and ${dangerousChanges.length - 5} more` : ""),
          inline: false,
        });
      }

      // Add role change details if any
      if (diff.rolesChanged.length > 0) {
        const roleChangeSummary = diff.rolesChanged
          .slice(0, 3)
          .map((r) => {
            const added = r.permissionsAdded.length > 0 ? `+${r.permissionsAdded.join(", ")}` : "";
            const removed = r.permissionsRemoved.length > 0 ? `-${r.permissionsRemoved.join(", ")}` : "";
            return `**${r.roleName}**: ${added} ${removed}`.trim();
          })
          .join("\n");

        embed.addFields({
          name: "Role Permission Changes",
          value: roleChangeSummary + (diff.rolesChanged.length > 3 ? `\n...and ${diff.rolesChanged.length - 3} more` : ""),
          inline: false,
        });
      }

      // Add new issues if any
      if (diff.issuesNew.length > 0) {
        const newIssuesSummary = diff.issuesNew
          .slice(0, 3)
          .map((i) => `• **${i.severity.toUpperCase()}**: ${i.title}`)
          .join("\n");

        embed.addFields({
          name: "New Security Issues",
          value: newIssuesSummary + (diff.issuesNew.length > 3 ? `\n...and ${diff.issuesNew.length - 3} more` : ""),
          inline: false,
        });
      }

      embed.setFooter({ text: "See DIFF.md in docs for full details" });

      await interaction.editReply({ embeds: [embed] });

      logger.info(
        { userId: user.id, guildId, dangerousChanges: dangerousChanges.length },
        "[audit:diff] Diff displayed"
      );
    } catch (err) {
      logger.error({ err, userId: user.id, guildId }, "[audit:diff] Failed to compute diff");
      await interaction.editReply({
        content: `❌ Failed to compute diff: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
