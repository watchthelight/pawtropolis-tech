/**
 * Pawtropolis Tech -- src/commands/audit/confirm.ts
 * WHAT: Confirmation/resume prompt for the /audit members and /audit nsfw
 *       subcommands. Both are destructive/expensive, so they ask before running
 *       and offer to resume an interrupted session.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { getActiveSession } from "../../store/auditSessionStore.js";
import { getFlaggedUserIds } from "../../store/flagsStore.js";
import { generateNonce } from "./shared.js";

export async function executeMembersNsfwConfirm(
  ctx: CommandContext<ChatInputCommandInteraction>,
): Promise<void> {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;
  if (!guildId || !guild) return;

  const subcommand = interaction.options.getSubcommand();

  const nsfwScope = subcommand === "nsfw" ? interaction.options.getString("scope", true) : null;

  // Fetch member count for confirmation message
  // WHY deferReply: The member fetch below can take several seconds for large
  // guilds, and Discord's 3-second interaction timeout is merciless.
  await withStep(ctx, "defer_confirmation", async () => {
    await interaction.deferReply();
  });

  await withStep(ctx, "build_confirmation", async () => {
    try {
      // Check for active session that can be resumed
      // WHY: NSFW audits can take 20+ minutes for large guilds. If the bot restarts
      // mid-scan (deploy, crash, Discord hiccup), we don't want to re-scan everyone.
      // The session tracks which users were already checked.
      const activeSession = getActiveSession(guildId, subcommand as "members" | "nsfw");

      if (activeSession) {
        // Offer to resume the active session
        const elapsed = Math.round((Date.now() - new Date(activeSession.started_at).getTime()) / 1000);
        const remaining = activeSession.total_to_scan - activeSession.scanned_count;

        const resumeEmbed = new EmbedBuilder()
          .setTitle("🔄 Resume Previous Audit?")
          .setDescription(
            `Found an incomplete ${subcommand} audit that was interrupted.\n\n` +
            `**Progress**: ${activeSession.scanned_count.toLocaleString()}/${activeSession.total_to_scan.toLocaleString()} scanned\n` +
            `**Flagged**: ${activeSession.flagged_count}\n` +
            `**Remaining**: ~${remaining.toLocaleString()} members\n` +
            `**Started**: ${elapsed > 3600 ? `${Math.round(elapsed / 3600)}h ago` : `${Math.round(elapsed / 60)}m ago`}\n\n` +
            `Do you want to **resume** where it left off or **start fresh**?`
          )
          .setColor(0x3B82F6)
          .setFooter({ text: "Resume will skip already-scanned members." });

        const nonce = generateNonce();
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`audit:${subcommand}:${nsfwScope ?? "none"}:resume:${activeSession.id}:${nonce}`)
            .setLabel("Resume")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("▶️"),
          new ButtonBuilder()
            .setCustomId(`audit:${subcommand}:${nsfwScope ?? "none"}:fresh:${activeSession.id}:${nonce}`)
            .setLabel("Start Fresh")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🔄"),
          new ButtonBuilder()
            .setCustomId(`audit:${subcommand}:${nsfwScope ?? "none"}:cancel:0:${nonce}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("❌")
        );

        await interaction.editReply({
          embeds: [resumeEmbed],
          components: [row],
        });

        logger.info(
          { userId: user.id, guildId, subcommand, sessionId: activeSession.id },
          "[audit] Found active session, showing resume prompt"
        );
        return;
      }

      // No active session - show normal confirmation
      const memberCount = guild.memberCount;

      // For NSFW flagged scope, count flagged members
      let targetCount = memberCount;
      if (nsfwScope === "flagged") {
        const flaggedMembers = getFlaggedUserIds(guildId);
        targetCount = flaggedMembers.length;
      }

      const nonce = generateNonce();

      // Build confirmation embed based on subcommand
      let confirmEmbed: EmbedBuilder;
      if (subcommand === "nsfw") {
        const scopeLabel = nsfwScope === "flagged" ? "flagged" : "all";
        confirmEmbed = new EmbedBuilder()
          .setTitle("⚠️ NSFW Avatar Audit")
          .setDescription(
            `This will scan **${targetCount.toLocaleString()}** ${scopeLabel} member avatars for NSFW content using Google Vision API.\n\n` +
            `**Scope**: ${nsfwScope === "flagged" ? "Flagged members only" : "All members"}\n` +
            `**Threshold**: 80%+ (Hard Evidence)\n` +
            `**Note**: This will make API calls for each member with an avatar.\n\n` +
            `This may send many messages. Are you sure?`
          )
          .setColor(0xE74C3C) // Red for NSFW
          .setFooter({ text: "Flagged users will need manual review." });
      } else {
        confirmEmbed = new EmbedBuilder()
          .setTitle("⚠️ Member Audit")
          .setDescription(
            `This will scan **${memberCount.toLocaleString()}** server members and flag suspicious accounts.\n\n` +
            `This may send many messages. Are you sure?`
          )
          .setColor(0xFBBF24) // Amber warning color
          .setFooter({ text: "This action cannot be easily undone." });
      }

      // Build action row with Confirm/Cancel buttons (include subcommand and scope in customId)
      const customIdBase = nsfwScope ? `audit:${subcommand}:${nsfwScope}` : `audit:${subcommand}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${customIdBase}:confirm:${nonce}`)
          .setLabel("Confirm")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId(`${customIdBase}:cancel:${nonce}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("❌")
      );

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [row],
      });

      logger.info(
        { userId: user.id, guildId, memberCount, targetCount, nonce, subcommand, nsfwScope },
        "[audit] Confirmation prompt sent"
      );
    } catch (err) {
      logger.error({ err, guildId, subcommand }, "[audit] Failed to fetch members for confirmation");
      await interaction.editReply({
        content: "❌ Failed to fetch server members. Please try again.",
      });
    }
  });
}
