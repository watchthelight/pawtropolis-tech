/**
 * Pawtropolis Tech -- src/features/gate/scan.ts
 * WHAT: Fire-and-forget avatar NSFW scan queueing for submitted gate apps,
 *       persistence of scan rows, and review-card refresh polling.
 * WHY: Extracted from gate.ts (#00011) to isolate the async scan concern.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client, User } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { scanAvatar, type ScanResult } from "../avatarScan.js";
import { ensureReviewMessage } from "../review.js";
import type { GuildConfig } from "../../lib/config.js";

function upsertScan(
  applicationId: string,
  data: {
    avatarUrl: string;
    nsfwScore: number | null;
    edgeScore: number;
    finalPct: number;
    furryScore: number;
    scalieScore: number;
    reason: ScanResult["reason"];
    evidence: ScanResult["evidence"];
  }
) {
  const evidenceHard = data.evidence.hard.length ? JSON.stringify(data.evidence.hard) : null;
  const evidenceSoft = data.evidence.soft.length ? JSON.stringify(data.evidence.soft) : null;
  const evidenceSafe = data.evidence.safe.length ? JSON.stringify(data.evidence.safe) : null;

  db.prepare(
    `
    INSERT INTO avatar_scan (application_id, avatar_url, nsfw_score, edge_score, final_pct, furry_score, scalie_score, reason, evidence_hard, evidence_soft, evidence_safe, scanned_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), unixepoch())
    ON CONFLICT(application_id) DO UPDATE SET
      avatar_url = excluded.avatar_url,
      nsfw_score = excluded.nsfw_score,
      edge_score = excluded.edge_score,
      final_pct = excluded.final_pct,
      furry_score = excluded.furry_score,
      scalie_score = excluded.scalie_score,
      reason = excluded.reason,
      evidence_hard = excluded.evidence_hard,
      evidence_soft = excluded.evidence_soft,
      evidence_safe = excluded.evidence_safe,
      scanned_at = excluded.scanned_at,
      updated_at = excluded.updated_at
  `
  ).run(
    applicationId,
    data.avatarUrl,
    data.nsfwScore,
    data.edgeScore,
    data.finalPct,
    data.furryScore,
    data.scalieScore,
    data.reason,
    evidenceHard,
    evidenceSoft,
    evidenceSafe
  );
}

/**
 * Polls for review card creation. This exists because avatar scan runs async
 * (via setImmediate) and needs to wait for the review card to exist before
 * it can refresh it with scan results.
 *
 * Why polling instead of event-driven: The review card is created by a different
 * code path (ensureReviewMessage) that may or may not have finished by the time
 * the avatar scan completes. Polling is simpler than adding cross-module eventing.
 *
 * 5s timeout is generous - review card creation typically takes <500ms. If we
 * timeout, we still try to refresh (it might exist by then anyway).
 */
async function waitForReviewCardMapping(
  appId: string,
  timeoutMs = 5000,
  pollMs = 200
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = db
      .prepare(
        `
        SELECT message_id
        FROM review_card
        WHERE app_id = ?
      `
      )
      .get(appId) as { message_id: string | null } | undefined;

    if (row && typeof row.message_id === "string" && row.message_id.length > 0) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

/**
 * Fire-and-forget avatar scan. Uses setImmediate to yield back to the event loop
 * immediately so the user gets their "application submitted" confirmation without
 * waiting for ML inference (which can take 2-5s with cold model load).
 *
 * Why not a job queue? For single-instance bots, setImmediate is sufficient.
 * If we ever scale to multiple instances, this should move to a proper job queue
 * (BullMQ, etc.) to prevent duplicate scans.
 *
 * The scan result updates the review card asynchronously - staff see the avatar
 * score appear after initial card creation.
 *
 * GOTCHA: The nested try-catch here looks paranoid, but setImmediate swallows
 * unhandled rejections differently than you'd expect. The outer catch handles
 * sync errors in callback setup, inner handles async errors. Don't simplify.
 */
export function queueAvatarScan(params: {
  appId: string;
  user: User;
  cfg: GuildConfig;
  client: Client;
  parentTraceId?: string | null;
}) {
  const { appId, user, cfg, client, parentTraceId } = params;
  // Pre-resolve avatar URL in case user changes avatar before scan runs
  const fallbackAvatarUrl = user.displayAvatarURL({
    extension: "png",
    forceStatic: true,
    size: 512,
  });
  const baseLog = {
    evt: "avatar_scan_job",
    appId,
    userId: user.id,
    parentTraceId: parentTraceId ?? null,
  };

  setImmediate(() => {
    // Outer try-catch for synchronous errors in callback setup
    try {
      (async () => {
        logger.info({ ...baseLog, phase: "start" }, "[avatarScan] job queued");

      let result: ScanResult | null = null;
      try {
        result = await scanAvatar(user, {
          nsfwThreshold: cfg.avatar_scan_nsfw_threshold ?? 0.6,
          edgeThreshold: cfg.avatar_scan_skin_edge_threshold ?? 0.18,
          wModel: cfg.avatar_scan_weight_model ?? 0.7,
          wEdge: cfg.avatar_scan_weight_edge ?? 0.3,
          traceId: parentTraceId ?? null,
        });
      } catch (err) {
        logger.warn({ ...baseLog, phase: "scan_failed", err }, "[avatarScan] scan threw");
      }

      const avatarUrl = result?.avatarUrl ?? fallbackAvatarUrl;
      if (!avatarUrl) {
        logger.warn(
          { ...baseLog, phase: "no_avatar_url" },
          "[avatarScan] unable to resolve avatar URL"
        );
        return;
      }

      const nsfwScore = result?.nsfwScore ?? null;
      const edgeScore = result?.edgeScore ?? 0;
      const finalPct = result?.finalPct ?? 0;
      const reason = result?.reason ?? "none";
      const furryScore = result?.furryScore ?? 0;
      const scalieScore = result?.scalieScore ?? 0;
      const evidence = result?.evidence ?? { hard: [], soft: [], safe: [] };

      try {
        upsertScan(appId, {
          avatarUrl,
          nsfwScore,
          edgeScore,
          finalPct,
          furryScore,
          scalieScore,
          reason,
          evidence,
        });
        logger.info(
          {
            ...baseLog,
            phase: "stored",
            finalPct,
            reason,
            nsfwScore,
            edgeScore,
            furryScore,
            scalieScore,
          },
          "[avatarScan] job stored result"
        );
      } catch (err) {
        logger.warn(
          { ...baseLog, phase: "store_failed", err },
          "[avatarScan] failed to persist scan result"
        );
        return;
      }

      try {
        const cardReady = await waitForReviewCardMapping(appId, 5000);
        if (!cardReady) {
          logger.info(
            { ...baseLog, phase: "card_pending" },
            "[avatarScan] review card not yet available; proceeding to refresh"
          );
        }
        await ensureReviewMessage(client, appId);
        logger.info({ ...baseLog, phase: "card_refreshed" }, "[avatarScan] review card refreshed");
      } catch (err) {
        logger.warn(
          { ...baseLog, phase: "card_refresh_failed", err },
          "[avatarScan] failed to refresh review card"
        );
      }
      })().catch((err) => {
        logger.error({ ...baseLog, phase: "crash", err }, "[avatarScan] job crashed");
      });
    } catch (err) {
      // Catch synchronous errors in setImmediate callback
      logger.error({ ...baseLog, phase: "sync_error", err }, "[avatarScan] synchronous error in job setup");
    }
  });
}
