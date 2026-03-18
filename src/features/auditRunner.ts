/**
 * Pawtropolis Tech — src/features/auditRunner.ts
 * WHAT: Headless audit runners for web-triggered scans
 * WHY: Dashboard needs to start scans without a Discord interaction.
 *      These functions handle session management, progress tracking via SSE,
 *      and flag users in the DB — no Discord embeds.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Guild, GuildMember } from "discord.js";
import { logger } from "../lib/logger.js";
import {
  analyzeMember,
  createEmptyStats,
  updateStats,
  type AuditStats,
} from "./botDetection.js";
import { isAlreadyFlagged, upsertManualFlag, getFlaggedUserIds } from "../store/flagsStore.js";
import { detectNsfwVision } from "./googleVision.js";
import { upsertNsfwFlag } from "../store/nsfwFlagsStore.js";
import { sleep } from "../lib/retry.js";
import {
  createSession,
  getScannedUserIds,
  markUserScanned,
  updateProgress,
  completeSession,
  type AuditSession,
} from "../store/auditSessionStore.js";
import { notifyDashboard } from "../web/notifyDashboard.js";
import { trackJoin } from "./activityTracker.js";

// ============================================================================
// Member Scan (headless)
// ============================================================================

/**
 * Fire-and-forget member scan triggered from the web dashboard.
 * Creates a session, scans all members, flags suspicious accounts, sends SSE progress.
 * Returns the session ID immediately — the scan runs in the background.
 */
export function triggerMemberScan(guild: Guild, startedBy: string): number {
  // We need the member count upfront for the session. guild.memberCount is cached
  // and close enough for the progress bar; the actual scan may find a different total.
  const estimatedTotal = guild.memberCount;

  const sessionId = createSession({
    guildId: guild.id,
    auditType: "members",
    scope: null,
    startedBy,
    totalToScan: estimatedTotal,
    channelId: "", // No Discord channel — headless
  });

  notifyDashboard("audit:scan_started", {
    sessionId,
    auditType: "members",
    totalToScan: estimatedTotal,
    startedBy,
  });

  // Fire-and-forget
  runMemberScanHeadless(guild, sessionId, startedBy, estimatedTotal).catch((err) => {
    logger.error({ err, guildId: guild.id, sessionId }, "[auditRunner:members] Background scan failed");
  });

  return sessionId;
}

async function runMemberScanHeadless(
  guild: Guild,
  sessionId: number,
  startedBy: string,
  estimatedTotal: number,
): Promise<void> {
  const stats: AuditStats = createEmptyStats();
  let flaggedCount = 0;
  let totalScanned = 0;

  try {
    logger.info({ guildId: guild.id, sessionId }, "[auditRunner:members] Starting headless member scan");

    // Paginate through all members
    let lastMemberId: string | undefined;
    const BATCH_SIZE = 1000;

    while (true) {
      const batch = await guild.members.list({
        limit: BATCH_SIZE,
        after: lastMemberId,
      });

      if (batch.size === 0) break;

      for (const member of batch.values()) {
        totalScanned++;
        lastMemberId = member.id;
        markUserScanned(sessionId, member.id);

        // Backfill user_activity for every member (upsert — safe to call multiple times)
        const joinedAtSec = member.joinedTimestamp
          ? Math.floor(member.joinedTimestamp / 1000)
          : Math.floor(Date.now() / 1000);
        trackJoin(guild.id, member.id, joinedAtSec);

        if (member.user.bot) continue;
        if (isAlreadyFlagged(guild.id, member.user.id)) continue;

        const result = analyzeMember(member, guild.id);

        if (result.shouldFlag) {
          const joinedAtSec = member.joinedTimestamp
            ? Math.floor(member.joinedTimestamp / 1000)
            : null;

          upsertManualFlag({
            guildId: guild.id,
            userId: member.user.id,
            reason: `[Audit] ${result.reasons.map((r) => r.label).join(", ")}`,
            flaggedBy: startedBy,
            joinedAt: joinedAtSec,
          });

          flaggedCount++;
          updateStats(stats, result.reasons);
        }

        // Progress update every 50 members
        if (totalScanned % 50 === 0) {
          updateProgress(sessionId, totalScanned, flaggedCount, 0);
          notifyDashboard("audit:scan_progress", {
            sessionId,
            auditType: "members",
            scannedCount: totalScanned,
            flaggedCount,
            totalToScan: estimatedTotal,
            apiCalls: 0,
          });
        }
      }
    }

    // Final progress + complete
    updateProgress(sessionId, totalScanned, flaggedCount, 0);
    completeSession(sessionId);
    notifyDashboard("audit:scan_completed", {
      sessionId,
      auditType: "members",
      scannedCount: totalScanned,
      flaggedCount,
    });

    logger.info(
      { guildId: guild.id, sessionId, totalScanned, flaggedCount },
      "[auditRunner:members] Headless scan complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id, sessionId }, "[auditRunner:members] Scan failed");
    // Update progress so dashboard shows last known state
    updateProgress(sessionId, totalScanned, flaggedCount, 0);
    throw err;
  }
}

// ============================================================================
// NSFW Scan (headless)
// ============================================================================

/**
 * Fire-and-forget NSFW avatar scan triggered from the web dashboard.
 * Creates a session, scans avatars via Google Vision API, flags NSFW, sends SSE progress.
 * Returns the session ID immediately — the scan runs in the background.
 */
export function triggerNsfwScan(
  guild: Guild,
  startedBy: string,
  scope: "all" | "flagged",
): number {
  const estimatedTotal = scope === "flagged"
    ? getFlaggedUserIds(guild.id).length
    : guild.memberCount;

  const sessionId = createSession({
    guildId: guild.id,
    auditType: "nsfw",
    scope,
    startedBy,
    totalToScan: estimatedTotal,
    channelId: "", // No Discord channel — headless
  });

  notifyDashboard("audit:scan_started", {
    sessionId,
    auditType: "nsfw",
    totalToScan: estimatedTotal,
    startedBy,
  });

  // Fire-and-forget
  runNsfwScanHeadless(guild, sessionId, startedBy, scope, estimatedTotal).catch((err) => {
    logger.error({ err, guildId: guild.id, sessionId, scope }, "[auditRunner:nsfw] Background scan failed");
  });

  return sessionId;
}

async function runNsfwScanHeadless(
  guild: Guild,
  sessionId: number,
  startedBy: string,
  scope: "all" | "flagged",
  estimatedTotal: number,
): Promise<void> {
  const NSFW_THRESHOLD = 0.8;
  const VISION_BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 200;

  let flaggedCount = 0;
  let totalScanned = 0;
  let apiCallCount = 0;

  try {
    logger.info({ guildId: guild.id, sessionId, scope }, "[auditRunner:nsfw] Starting headless NSFW scan");

    // Collect members to scan
    const membersToScan: GuildMember[] = [];

    if (scope === "flagged") {
      const flaggedUserIds = getFlaggedUserIds(guild.id);
      for (const userId of flaggedUserIds) {
        try {
          const member = await guild.members.fetch(userId);
          membersToScan.push(member);
        } catch {
          // Member left — skip
        }
      }
    } else {
      let lastMemberId: string | undefined;
      const BATCH_SIZE = 1000;

      while (true) {
        const batch = await guild.members.list({
          limit: BATCH_SIZE,
          after: lastMemberId,
        });
        if (batch.size === 0) break;
        for (const member of batch.values()) {
          membersToScan.push(member);
          lastMemberId = member.id;

          // Backfill user_activity for every member (upsert)
          const joinedAtSec = member.joinedTimestamp
            ? Math.floor(member.joinedTimestamp / 1000)
            : Math.floor(Date.now() / 1000);
          trackJoin(guild.id, member.id, joinedAtSec);
        }
      }
    }

    // Filter: skip bots and members without custom avatars
    const membersToProcess: Array<{ member: GuildMember; avatarUrl: string }> = [];
    for (const member of membersToScan) {
      if (member.user.bot) {
        totalScanned++;
        markUserScanned(sessionId, member.id);
        continue;
      }

      const avatarUrl = member.user.avatar
        ? member.user.displayAvatarURL({ extension: "png", size: 256 })
        : null;

      if (!avatarUrl) {
        totalScanned++;
        markUserScanned(sessionId, member.id);
        continue;
      }

      membersToProcess.push({ member, avatarUrl });
    }

    // Process in batches with concurrent Vision API calls
    for (let i = 0; i < membersToProcess.length; i += VISION_BATCH_SIZE) {
      const batch = membersToProcess.slice(i, i + VISION_BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async ({ member, avatarUrl }) => {
          apiCallCount++;
          const visionResult = await detectNsfwVision(avatarUrl);
          return { member, avatarUrl, visionResult };
        })
      );

      for (const { member, avatarUrl, visionResult } of batchResults) {
        totalScanned++;
        markUserScanned(sessionId, member.id);

        if (!visionResult) continue;

        if (visionResult.adultScore >= NSFW_THRESHOLD) {
          upsertNsfwFlag({
            guildId: guild.id,
            userId: member.user.id,
            avatarUrl,
            nsfwScore: visionResult.adultScore,
            reason: "hard_evidence",
            flaggedBy: startedBy,
          });
          flaggedCount++;
        }
      }

      // Delay between batches
      if (i + VISION_BATCH_SIZE < membersToProcess.length) {
        await sleep(BATCH_DELAY_MS);
      }

      // Progress update after each batch
      updateProgress(sessionId, totalScanned, flaggedCount, apiCallCount);
      notifyDashboard("audit:scan_progress", {
        sessionId,
        auditType: "nsfw",
        scannedCount: totalScanned,
        flaggedCount,
        totalToScan: estimatedTotal,
        apiCalls: apiCallCount,
      });
    }

    // Complete
    updateProgress(sessionId, totalScanned, flaggedCount, apiCallCount);
    completeSession(sessionId);
    notifyDashboard("audit:scan_completed", {
      sessionId,
      auditType: "nsfw",
      scannedCount: totalScanned,
      flaggedCount,
    });

    logger.info(
      { guildId: guild.id, sessionId, scope, totalScanned, flaggedCount, apiCallCount },
      "[auditRunner:nsfw] Headless scan complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id, sessionId, scope }, "[auditRunner:nsfw] Scan failed");
    updateProgress(sessionId, totalScanned, flaggedCount, apiCallCount);
    throw err;
  }
}
