/**
 * Pawtropolis Tech -- src/web/routes/scan.ts
 * WHAT: /api/scan/* image scan dashboard route(s).
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { loadApplication } from "../../features/review/queries.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError, ReviewBody } from "../dashboardApiTypes.js";
import { notifyDashboard } from "../notifyDashboard.js";
import type { DashboardRouteContext } from "./context.js";

const GUILD_ID = process.env.GUILD_ID!;

export function registerScanRoutes(server: FastifyInstance, ctx: DashboardRouteContext): void {
  const { client } = ctx;

  // POST /api/scan/:appId/nsfw — On-demand NSFW scan of avatar + banner via Google Vision
  server.post<{ Params: { appId: string }; Body: ReviewBody }>("/api/scan/:appId/nsfw", async (request, reply) => {
    const { userId, tier } = request.body ?? {};
    const { appId } = request.params;
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    try {
      // Fetch fresh user data from Discord (not cache — URLs may be stale)
      const user = await client.users.fetch(app.user_id, { force: true });
      const avatarUrl = user.displayAvatarURL({ extension: "png", forceStatic: true, size: 1024 });
      const bannerUrl = user.bannerURL({ size: 512 }) ?? null;

      // Scan avatar NSFW
      const { scanAvatar, upsertFullScan } = await import("../../features/avatarScan.js");
      const avatarResult = await scanAvatar(avatarUrl);

      // Scan banner NSFW (if exists)
      let bannerResult: { finalPct: number; nsfwScore: number | null; reason: string; evidence: { hard: any[]; soft: any[]; safe: any[] } } | null = null;
      if (bannerUrl) {
        const { detectNsfwVision, calculateVisionScore } = await import("../../features/googleVision.js");
        const visionResult = await detectNsfwVision(bannerUrl);
        if (visionResult) {
          const score = calculateVisionScore(visionResult);
          let reason = "none";
          if (visionResult.adultScore >= 0.8) reason = "hard_evidence";
          else if (visionResult.adultScore >= 0.5 || visionResult.racyScore >= 0.8) reason = "soft_evidence";
          else if (visionResult.racyScore >= 0.5) reason = "suggestive";
          bannerResult = {
            finalPct: Math.round(score * 100),
            nsfwScore: score,
            reason,
            evidence: {
              hard: visionResult.adultScore >= 0.5 ? [{ tag: `adult:${visionResult.raw.adult}`, p: visionResult.adultScore }] : [],
              soft: visionResult.racyScore >= 0.5 ? [{ tag: `racy:${visionResult.raw.racy}`, p: visionResult.racyScore }] : [],
              safe: [],
            },
          };
        }
      }

      // Upsert all results
      upsertFullScan(appId, {
        avatarUrl,
        nsfwScore: avatarResult.nsfwScore,
        finalPct: avatarResult.finalPct,
        reason: avatarResult.reason,
        evidence: avatarResult.evidence,
        bannerUrl,
        bannerNsfwScore: bannerResult?.nsfwScore ?? null,
        bannerFinalPct: bannerResult?.finalPct ?? 0,
        bannerReason: (bannerResult?.reason as any) ?? null,
        bannerEvidence: bannerResult?.evidence ?? null,
        avatarAiScore: null, // Don't overwrite AI scores
        bannerAiScore: null,
      });

      notifyDashboard("scan:complete", { appId });

      return {
        success: true,
        data: {
          avatarNsfwPct: avatarResult.finalPct,
          bannerNsfwPct: bannerResult?.finalPct ?? 0,
          hasBanner: !!bannerUrl,
        },
      } satisfies ApiSuccess;
    } catch (err) {
      logger.error({ err, appId }, "[dashboardApi] NSFW scan failed");
      return reply.code(500).send({ success: false, error: "NSFW scan failed" } satisfies ApiError);
    }
  });

  // POST /api/scan/:appId/ai — On-demand AI-generated detection of avatar + banner
  server.post<{ Params: { appId: string }; Body: ReviewBody }>("/api/scan/:appId/ai", async (request, reply) => {
    const { userId, tier } = request.body ?? {};
    const { appId } = request.params;
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    try {
      const user = await client.users.fetch(app.user_id, { force: true });
      const avatarUrl = user.displayAvatarURL({ extension: "png", forceStatic: true, size: 1024 });
      const bannerUrl = user.bannerURL({ size: 512 }) ?? null;

      const { detectAIForImage } = await import("../../features/aiDetection/index.js");

      // Scan avatar AI
      const avatarAi = await detectAIForImage(avatarUrl, "avatar", GUILD_ID);

      // Scan banner AI (if exists)
      let bannerAi: Awaited<ReturnType<typeof detectAIForImage>> | null = null;
      if (bannerUrl) {
        bannerAi = await detectAIForImage(bannerUrl, "banner", GUILD_ID);
      }

      // Store scores
      const { updateAiScores } = await import("../../features/avatarScan.js");

      // Ensure avatar_scan row exists (may not if NSFW scan hasn't run yet)
      const existing = db.prepare("SELECT 1 FROM avatar_scan WHERE application_id = ?").get(appId);
      if (!existing) {
        db.prepare("INSERT OR IGNORE INTO avatar_scan (application_id, final_pct, reason) VALUES (?, 0, 'none')").run(appId);
      }

      updateAiScores(appId, avatarAi.averageScore, bannerAi?.averageScore ?? null);

      notifyDashboard("scan:complete", { appId });

      return {
        success: true,
        data: {
          avatarAiPct: avatarAi.averageScore !== null ? Math.round(avatarAi.averageScore * 100) : null,
          bannerAiPct: bannerAi?.averageScore !== null ? Math.round((bannerAi?.averageScore ?? 0) * 100) : null,
          hasBanner: !!bannerUrl,
          avatarServices: avatarAi.services,
          bannerServices: bannerAi?.services ?? [],
        },
      } satisfies ApiSuccess;
    } catch (err) {
      logger.error({ err, appId }, "[dashboardApi] AI scan failed");
      return reply.code(500).send({ success: false, error: "AI scan failed" } satisfies ApiError);
    }
  });
}
