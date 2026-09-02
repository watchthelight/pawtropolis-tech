/**
 * Pawtropolis Tech -- src/commands/audit/members.ts
 * WHAT: Background runner for /audit members (bot-like account detection).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ButtonInteraction,
  EmbedBuilder,
  type TextChannel,
  type GuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  analyzeMember,
  createEmptyStats,
  updateStats,
  MAX_SCORE,
  type AuditStats,
} from "../../features/botDetection.js";
import { isAlreadyFlagged, upsertManualFlag } from "../../store/flagsStore.js";
import { sleep } from "../../lib/retry.js";
import {
  createSession,
  markUserScanned,
  getScannedUserIds,
  updateProgress,
  completeSession,
  type AuditSession,
} from "../../store/auditSessionStore.js";
import { notifyDashboard } from "../../web/notifyDashboard.js";

/**
 * Run the members audit process (bot detection)
 *
 * Scans all guild members looking for accounts that match bot/spam heuristics:
 * - No avatar, new account, no activity, low level, suspicious username patterns
 *
 * Unlike the NSFW audit, this is CPU-bound (no external API calls), so it's
 * much faster but also has less sophisticated detection. False positives happen.
 */
export async function runMembersAudit(
  interaction: ButtonInteraction,
  guild: NonNullable<ButtonInteraction["guild"]>,
  channel: TextChannel,
  resumeSession: AuditSession | null = null
): Promise<void> {
  const startTime = Date.now();
  const stats: AuditStats = createEmptyStats();
  let flaggedCount = resumeSession?.flagged_count ?? 0;
  let skippedCount = 0;
  let totalScanned = resumeSession?.scanned_count ?? 0;

  // Load already-scanned user IDs if resuming
  const alreadyScanned = resumeSession ? getScannedUserIds(resumeSession.id) : new Set<string>();

  try {
    // The member cache is complete (GuildMembers intent, uncapped cache, fetched at boot),
    // so the scan reads it directly instead of paging the whole guild over REST again.
    logger.info({ guildId: guild.id, resuming: !!resumeSession }, "[audit:members] Starting member scan...");

    const allMembers: GuildMember[] = [...guild.members.cache.values()];
    const totalMembers = allMembers.length;

    // Create or reuse session
    let sessionId: number;
    if (resumeSession) {
      sessionId = resumeSession.id;
    } else {
      sessionId = createSession({
        guildId: guild.id,
        auditType: "members",
        scope: null,
        startedBy: interaction.user.id,
        totalToScan: totalMembers,
        channelId: channel.id,
      });
    }

    notifyDashboard("audit:scan_started", {
      sessionId,
      auditType: "members",
      totalToScan: totalMembers,
      startedBy: interaction.user.id,
    });

    // Process members
    for (const member of allMembers) {
      // Skip if already scanned in this session (for resume)
      if (alreadyScanned.has(member.id)) {
        continue;
      }

      totalScanned++;
      markUserScanned(sessionId, member.id);

      // Skip bots
      if (member.user.bot) {
        continue;
      }

      // Skip already flagged users
      if (isAlreadyFlagged(guild.id, member.user.id)) {
        skippedCount++;
        continue;
      }

      // Analyze member
      const result = analyzeMember(member, guild.id);

      if (result.shouldFlag) {
        // Flag the user
        const joinedAtSec = member.joinedTimestamp
          ? Math.floor(member.joinedTimestamp / 1000)
          : null;

        upsertManualFlag({
          guildId: guild.id,
          userId: member.user.id,
          reason: `[Audit] ${result.reasons.map((r) => r.label).join(", ")}`,
          flaggedBy: interaction.user.id,
          joinedAt: joinedAtSec,
        });

        flaggedCount++;
        updateStats(stats, result.reasons);

        // Send flag embed to channel
        const flagEmbed = new EmbedBuilder()
          .setTitle(`🚨 Suspicious Account [${flaggedCount}]`)
          .setColor(0xED4245) // Red
          .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
          .addFields(
            { name: "User", value: `${member} (\`${member.id}\`)`, inline: true },
            { name: "Score", value: `${result.score}/${MAX_SCORE}`, inline: true },
            { name: "Flags", value: result.reasons.map((r) => `• ${r.label}`).join("\n") || "None" }
          )
          .setFooter({ text: `Scanned: ${totalScanned.toLocaleString()} members` });

        await channel.send({ embeds: [flagEmbed] });

        // Small delay to avoid rate limits
        // WHY 300ms: Discord's message rate limit is ~5/5sec per channel.
        // 300ms gives us headroom without making the audit painfully slow.
        await sleep(300);
      }

      // Update progress every 50 members for real-time feedback
      if (totalScanned % 50 === 0) {
        updateProgress(sessionId, totalScanned, flaggedCount, 0);
        notifyDashboard("audit:scan_progress", {
          sessionId,
          auditType: "members",
          scannedCount: totalScanned,
          flaggedCount,
          totalToScan: totalMembers,
          apiCalls: 0,
        });

        // GOTCHA: interaction.editReply can fail if the interaction token expired
        // (15 min limit) or if the message was deleted. We catch and log but don't
        // abort the audit - the channel embeds are the real output anyway.
        try {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🔍 Auditing members...")
                .setDescription(
                  `**${totalScanned.toLocaleString()}** members scanned\n` +
                  `**${flaggedCount}** flagged · **${skippedCount}** already flagged\n` +
                  `⏱️ ${elapsed}s elapsed`
                )
                .setColor(0x3B82F6),
            ],
          });
        } catch (err) {
          logger.debug({ err, guildId: guild.id, totalScanned }, "[audit] Progress update failed (non-fatal)");
        }
      }
    }

    // Mark session complete
    updateProgress(sessionId, totalScanned, flaggedCount, 0);
    completeSession(sessionId);
    notifyDashboard("audit:scan_completed", {
      sessionId,
      auditType: "members",
      scannedCount: totalScanned,
      flaggedCount,
    });

    // Calculate duration
    const durationSec = Math.round((Date.now() - startTime) / 1000);

    // Send summary embed
    const summaryEmbed = new EmbedBuilder()
      .setTitle("✅ Audit Complete")
      .setColor(0x57F287) // Green
      .addFields(
        { name: "Members Scanned", value: totalScanned.toLocaleString(), inline: true },
        { name: "Flagged", value: flaggedCount.toString(), inline: true },
        { name: "Already Flagged", value: skippedCount.toString(), inline: true },
        { name: "Duration", value: `${durationSec}s`, inline: true },
        {
          name: "Detection Breakdown",
          value:
            `• No avatar: ${stats.noAvatar}\n` +
            `• New accounts (<7d): ${stats.newAccount}\n` +
            `• No activity: ${stats.noActivity}\n` +
            `• Low level (<5): ${stats.lowLevel}\n` +
            `• Bot usernames: ${stats.botUsername}`,
        }
      )
      .setTimestamp();

    if (resumeSession) {
      summaryEmbed.addFields({ name: "Resumed", value: `Skipped ${alreadyScanned.size} already-scanned`, inline: true });
    }

    await channel.send({ embeds: [summaryEmbed] });

    // Update original progress message to show complete
    try {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Audit Complete")
            .setDescription(`Scanned ${totalScanned.toLocaleString()} members, flagged ${flaggedCount}.`)
            .setColor(0x57F287),
        ],
      });
    } catch (err) {
      logger.debug({ err }, "[audit:members] Final message edit failed (may be deleted)");
    }

    logger.info(
      {
        guildId: guild.id,
        totalScanned,
        flaggedCount,
        skippedCount,
        durationSec,
        stats,
      },
      "[audit:members] Audit complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "[audit:members] Audit failed");

    // Best-effort error notification. If this also fails, we're probably having
    // a bad day with Discord's API and there's nothing more we can do.
    try {
      await channel.send({
        content: `❌ Audit failed with error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } catch (err) {
      logger.debug({ err, channelId: channel.id }, "[audit] Channel send failed (may be inaccessible)");
    }
  }
}
