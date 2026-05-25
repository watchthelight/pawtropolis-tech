/**
 * Pawtropolis Tech -- src/commands/audit/security.ts
 * WHAT: /audit security handler. Generates permission/security docs and
 *       pushes them to GitHub.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { generateAuditDocs, commitAndPushDocs } from "../../features/serverAuditDocs.js";

export async function executeSecurity(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;
  if (!guildId || !guild) return;

  await withStep(ctx, "handle_security", async () => {
    // Already deferred above

    // Helper to update progress with verbose status
    const updateProgress = async (step: string, detail?: string) => {
      const embed = new EmbedBuilder()
        .setTitle("🔄 Security Audit in Progress")
        .setDescription(`**${step}**${detail ? `\n\`${detail}\`` : ""}`)
        .setColor(0x3B82F6)
        .setTimestamp();

      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {
        // Interaction may have expired, ignore
      }
    };

    try {
      logger.info({ userId: user.id, guildId }, "[audit:security] Starting security audit");

      // Step 1: Fetch roles
      await updateProgress("Fetching server roles", `Analyzing ${guild.name}...`);

      // Step 2: Generate docs (includes fetching channels, analyzing)
      await updateProgress("Analyzing permissions", "Scanning roles and channels...");
      const result = await generateAuditDocs(guild);

      await updateProgress("Documentation generated", `${result.roleCount} roles, ${result.channelCount} channels, ${result.issueCount} issues`);

      // Step 3: Commit and push to GitHub with verbose progress
      const pushResult = await commitAndPushDocs(result, async (step, detail) => {
        await updateProgress(step, detail);
      });

      const embed = new EmbedBuilder()
        .setTitle("✅ Security Audit Complete")
        .setColor(0x22C55E)
        .addFields(
          { name: "Roles", value: result.roleCount.toLocaleString(), inline: true },
          { name: "Channels", value: result.channelCount.toLocaleString(), inline: true },
          { name: "Active Issues", value: result.issueCount.toLocaleString(), inline: true },
          {
            name: "Issue Breakdown",
            value: [
              `🔴 Critical: ${result.criticalCount}`,
              `🟠 High: ${result.highCount}`,
              `🟡 Medium: ${result.mediumCount}`,
              `🟢 Low: ${result.lowCount}`,
              `✅ Acknowledged: ${result.acknowledgedCount}`,
            ].join("\n"),
            inline: false,
          }
        )
        .setTimestamp();

      // Add GitHub link or error
      if (pushResult.success && pushResult.docsUrl) {
        embed.setDescription(`Server documentation has been updated and pushed to GitHub.`);
        embed.addFields({
          name: "📎 View Report",
          value: `[View CONFLICTS.md on GitHub](${pushResult.docsUrl})`,
          inline: false,
        });
      } else if (pushResult.error === "No changes to commit") {
        embed.setDescription("Server documentation regenerated. No changes detected since last audit.");
      } else if (pushResult.error) {
        embed.setDescription("Server documentation regenerated but push to GitHub failed.");
        // Truncate error to fit Discord's 1024 char field limit
        const truncatedError = pushResult.error.length > 1000
          ? pushResult.error.slice(0, 997) + "..."
          : pushResult.error;
        embed.addFields({
          name: "⚠️ Push Error",
          value: truncatedError || "Unknown error",
          inline: false,
        });
        embed.setColor(0xF59E0B); // Warning color
      } else {
        embed.setDescription("Server documentation regenerated. GitHub push not configured.");
      }

      logger.debug(
        { embedJson: JSON.stringify(embed.toJSON()) },
        "[audit:security] About to send final embed"
      );

      try {
        await interaction.editReply({ embeds: [embed] });
        logger.info("[audit:security] Final embed sent successfully");
      } catch (editErr: unknown) {
        const e = editErr instanceof Error ? editErr : new Error(String(editErr));
        logger.error(
          { err: e.message, code: (e as { code?: number }).code, rawError: editErr },
          "[audit:security] Failed to send final embed"
        );
        // Try sending a simpler fallback embed
        const fallbackEmbed = new EmbedBuilder()
          .setTitle("✅ Security Audit Complete")
          .setColor(0x22C55E)
          .setDescription(
            `**Roles:** ${result.roleCount}\n` +
            `**Channels:** ${result.channelCount}\n` +
            `**Issues:** ${result.issueCount} (${result.criticalCount} critical)`
          )
          .setTimestamp();

        try {
          await interaction.editReply({ embeds: [fallbackEmbed] });
          logger.info("[audit:security] Fallback embed sent");
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr }, "[audit:security] Fallback embed also failed");
          throw editErr;
        }
      }

      logger.info(
        { userId: user.id, guildId, ...result, pushResult },
        "[audit:security] Security audit complete"
      );
    } catch (err) {
      logger.error({ err, userId: user.id, guildId }, "[audit:security] Failed to generate docs");
      await interaction.editReply({
        content: `❌ Failed to generate documentation: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
