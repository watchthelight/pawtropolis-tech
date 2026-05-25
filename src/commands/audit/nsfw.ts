/**
 * Pawtropolis Tech -- src/commands/audit/nsfw.ts
 * WHAT: Background runner for /audit nsfw (avatar NSFW scan via Google Vision).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ButtonInteraction,
  EmbedBuilder,
  type TextChannel,
  type GuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { renderProgressBar } from "../../features/botDetection.js";
import { getFlaggedUserIds } from "../../store/flagsStore.js";
import { detectNsfwVision } from "../../features/googleVision.js";
import { upsertNsfwFlag } from "../../store/nsfwFlagsStore.js";
import { sleep } from "../../lib/retry.js";
import { googleReverseImageUrl } from "../../ui/reviewCard.js";
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
 * Run the NSFW avatar audit process
 *
 * This is the expensive one. Every member with a custom avatar triggers a
 * Google Cloud Vision API call (~$1.50/1000 images). For a 10k member guild,
 * that's potentially $15 per full scan. The 80% threshold is intentionally
 * high to minimize false positives - we'd rather miss edge cases than flag
 * someone's abstract art as porn.
 */
export async function runNsfwAudit(
  interaction: ButtonInteraction,
  guild: NonNullable<ButtonInteraction["guild"]>,
  channel: TextChannel,
  scope: "all" | "flagged",
  resumeSession: AuditSession | null = null
): Promise<void> {
  const startTime = Date.now();
  let flaggedCount = resumeSession?.flagged_count ?? 0;
  let totalScanned = resumeSession?.scanned_count ?? 0;
  let apiCallCount = resumeSession?.api_calls ?? 0;
  let skippedNoAvatar = 0;
  let skippedAlreadyScanned = 0;

  const NSFW_THRESHOLD = 0.8; // 80% = hard evidence (see doc comment above)
  const PROGRESS_UPDATE_INTERVAL = 10; // Update every 10 members for real-time feedback

  // Batch processing configuration for Vision API calls
  // Before: Sequential with 100ms sleep per member = 100+ seconds for 1000 members
  // After: 10 concurrent requests with 200ms between batches = ~15 seconds for 1000 members
  // CAREFUL: Don't crank VISION_BATCH_SIZE too high or you'll hit Vision API rate limits
  const VISION_BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 200;

  // Load already-scanned user IDs if resuming
  const alreadyScanned = resumeSession ? getScannedUserIds(resumeSession.id) : new Set<string>();

  try {
    logger.info({ guildId: guild.id, scope, resuming: !!resumeSession, alreadyScannedCount: alreadyScanned.size }, "[audit:nsfw] Starting avatar scan...");

    // Collect members to scan based on scope
    const membersToScan: GuildMember[] = [];

    if (scope === "flagged") {
      // Get flagged user IDs and fetch those members
      const flaggedUserIds = getFlaggedUserIds(guild.id);
      logger.info({ guildId: guild.id, flaggedCount: flaggedUserIds.length }, "[audit:nsfw] Fetching flagged members");

      for (const userId of flaggedUserIds) {
        try {
          const member = await guild.members.fetch(userId);
          membersToScan.push(member);
        } catch {
          // Member may have left the server - silently skip
          // This is expected behavior, not an error worth logging
        }
      }
    } else {
      // Paginate through all members
      let lastMemberId: string | undefined;
      let processedBatches = 0;
      const BATCH_SIZE = 1000;

      while (true) {
        const batch = await guild.members.list({
          limit: BATCH_SIZE,
          after: lastMemberId,
        });

        if (batch.size === 0) break;

        processedBatches++;
        logger.info({
          guildId: guild.id,
          batchNumber: processedBatches,
          batchSize: batch.size,
        }, "[audit:nsfw] Fetching batch");

        for (const member of batch.values()) {
          membersToScan.push(member);
          lastMemberId = member.id;
        }
      }
    }

    const totalMembers = membersToScan.length;
    logger.info({ guildId: guild.id, totalMembers }, "[audit:nsfw] Starting scan");

    // Create or use existing session
    // The session is our crash-recovery mechanism. If the bot dies mid-audit,
    // we can offer to resume from where we left off instead of re-scanning
    // thousands of avatars (and burning API quota).
    let sessionId: number;
    if (resumeSession) {
      sessionId = resumeSession.id;
    } else {
      sessionId = createSession({
        guildId: guild.id,
        auditType: "nsfw",
        scope,
        startedBy: interaction.user.id,
        totalToScan: totalMembers,
        channelId: channel.id,
      });
    }

    notifyDashboard("audit:scan_started", {
      sessionId,
      auditType: "nsfw",
      totalToScan: totalMembers,
      startedBy: interaction.user.id,
    });

    // Filter members to scan (skip already-scanned for resume, bots, no avatar)
    const membersToProcess: Array<{ member: GuildMember; avatarUrl: string }> = [];
    for (const member of membersToScan) {
      // Skip if already scanned in this session (for resume)
      if (alreadyScanned.has(member.id)) {
        skippedAlreadyScanned++;
        continue;
      }

      // Skip bots
      if (member.user.bot) {
        totalScanned++;
        markUserScanned(sessionId, member.id);
        continue;
      }

      // Skip users without custom avatars (default Discord avatars)
      // WHY: Default avatars are Discord-generated geometric patterns based on
      // discriminator. Zero chance of NSFW content, so don't waste API calls.
      const avatarUrl = member.user.avatar
        ? member.user.displayAvatarURL({ extension: "png", size: 256 })
        : null;

      if (!avatarUrl) {
        skippedNoAvatar++;
        totalScanned++;
        markUserScanned(sessionId, member.id);
        continue;
      }

      membersToProcess.push({ member, avatarUrl });
    }

    // Process members in batches with concurrent Vision API calls
    // This replaces sequential processing with 100ms sleep per member
    //
    // PERFORMANCE NOTE: Promise.all means if one request hangs, we wait for all
    // of them. Could use Promise.allSettled for better resilience, but then we'd
    // need to handle partial failures per-batch. Current approach is simpler and
    // Vision API is reliable enough that timeouts are rare.
    let processedInThisRun = 0;
    for (let i = 0; i < membersToProcess.length; i += VISION_BATCH_SIZE) {
      const batch = membersToProcess.slice(i, i + VISION_BATCH_SIZE);

      // Process batch concurrently
      const batchResults = await Promise.all(
        batch.map(async ({ member, avatarUrl }) => {
          apiCallCount++;
          const visionResult = await detectNsfwVision(avatarUrl);
          return { member, avatarUrl, visionResult };
        })
      );

      // Process results sequentially (for flagging and sending embeds)
      for (const { member, avatarUrl, visionResult } of batchResults) {
        processedInThisRun++;
        totalScanned++;
        markUserScanned(sessionId, member.id);

        if (!visionResult) {
          // Vision API returned null - could be network error, quota exceeded,
          // or image couldn't be processed. We skip rather than retry because
          // retries would slow down the audit and most failures are transient.
          continue;
        }

        // Check if adult score meets threshold
        if (visionResult.adultScore >= NSFW_THRESHOLD) {
          // Flag the user
          upsertNsfwFlag({
            guildId: guild.id,
            userId: member.user.id,
            avatarUrl,
            nsfwScore: visionResult.adultScore,
            reason: "hard_evidence",
            flaggedBy: interaction.user.id,
          });

          flaggedCount++;

          // Send flag embed to channel
          // Reverse image search link helps mods verify - sometimes Vision flags
          // legitimate art or memes that happen to have skin tones
          const reverseSearchUrl = googleReverseImageUrl(avatarUrl);
          const flagEmbed = new EmbedBuilder()
            .setTitle(`🔞 NSFW Avatar Detected [${flaggedCount}]`)
            .setColor(0xE74C3C) // Dark red
            .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
            .addFields(
              { name: "User", value: `${member} (\`${member.id}\`)`, inline: true },
              { name: "Score", value: `${Math.round(visionResult.adultScore * 100)}%`, inline: true },
              { name: "Classification", value: "Hard Evidence (Adult Content)" },
              { name: "Avatar", value: `[Reverse Image Search](${reverseSearchUrl})` }
            )
            .setFooter({ text: `Progress: ${totalScanned.toLocaleString()}/${totalMembers.toLocaleString()}` });

          await channel.send({ embeds: [flagEmbed] });

          // Small delay between flagged notifications to avoid Discord rate limits
          await sleep(300);
        }
      }

      // Small delay between batches (instead of per-member delay)
      if (i + VISION_BATCH_SIZE < membersToProcess.length) {
        await sleep(BATCH_DELAY_MS);
      }

      // Update progress after each batch
      // We save to DB frequently so resume works even if the bot crashes mid-scan.
      // The conditional ensures we don't spam the database on every single member.
      if (processedInThisRun % PROGRESS_UPDATE_INTERVAL === 0 || i + VISION_BATCH_SIZE >= membersToProcess.length) {
        // Save progress to database + notify dashboard
        updateProgress(sessionId, totalScanned, flaggedCount, apiCallCount);
        notifyDashboard("audit:scan_progress", {
          sessionId,
          auditType: "nsfw",
          scannedCount: totalScanned,
          flaggedCount,
          totalToScan: totalMembers,
          apiCalls: apiCallCount,
        });

        try {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const pct = Math.round((totalScanned / totalMembers) * 100);
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🔞 Scanning avatars for NSFW content...")
                .setDescription(
                  `${renderProgressBar(totalScanned, totalMembers)}\n\n` +
                  `**${totalScanned.toLocaleString()}** / **${totalMembers.toLocaleString()}** members (${pct}%)\n` +
                  `🚩 **${flaggedCount}** flagged · 📡 **${apiCallCount}** API calls\n` +
                  `⏱️ ${elapsed}s elapsed`
                )
                .setColor(0xE74C3C),
            ],
          });
        } catch (err) {
          logger.debug({ err, guildId: guild.id, totalScanned }, "[audit:nsfw] Progress update failed (non-fatal)");
        }
      }
    }

    // Mark session complete
    completeSession(sessionId);
    notifyDashboard("audit:scan_completed", {
      sessionId,
      auditType: "nsfw",
      scannedCount: totalScanned,
      flaggedCount,
    });

    // Calculate duration
    const durationSec = Math.round((Date.now() - startTime) / 1000);

    // Send summary embed
    const scopeDesc = scope === "flagged" ? "Flagged members only" : "All members";
    const summaryEmbed = new EmbedBuilder()
      .setTitle("✅ NSFW Audit Complete")
      .setColor(0x57F287) // Green
      .addFields(
        { name: "Scope", value: scopeDesc, inline: true },
        { name: "Avatars Scanned", value: totalScanned.toLocaleString(), inline: true },
        { name: "NSFW Flagged", value: flaggedCount.toString(), inline: true },
        { name: "No Avatar", value: skippedNoAvatar.toString(), inline: true },
        { name: "Duration", value: `${durationSec}s`, inline: true },
        { name: "API Calls", value: apiCallCount.toString(), inline: true }
      )
      .setTimestamp();

    if (resumeSession) {
      summaryEmbed.addFields({ name: "Resumed", value: `Skipped ${skippedAlreadyScanned} already-scanned`, inline: true });
    }

    await channel.send({ embeds: [summaryEmbed] });

    // Update original progress message to show complete
    try {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ NSFW Audit Complete")
            .setDescription(`Scanned ${totalScanned.toLocaleString()} avatars, flagged ${flaggedCount}.`)
            .setColor(0x57F287),
        ],
      });
    } catch (err) {
      logger.debug({ err }, "[audit:nsfw] Completion message edit failed (may be deleted)");
    }

    logger.info(
      {
        guildId: guild.id,
        scope,
        totalScanned,
        flaggedCount,
        apiCallCount,
        skippedNoAvatar,
        skippedAlreadyScanned,
        durationSec,
        resumed: !!resumeSession,
      },
      "[audit:nsfw] Audit complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Audit failed");

    try {
      await channel.send({
        content: `❌ NSFW audit failed with error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } catch (err) {
      logger.debug({ err, channelId: channel.id }, "[audit:nsfw] Channel send failed (may be inaccessible)");
    }
  }
}
