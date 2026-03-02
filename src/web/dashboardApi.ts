/**
 * Pawtropolis Tech -- src/web/dashboardApi.ts
 * WHAT: Fastify server on port 3003 for dashboard mutation requests.
 * WHY: Dashboard UI proxies review actions (claim, approve, reject, kick, unclaim)
 *      through this API. Bot independently verifies tier and executes mutations.
 * AUTH: X-Dashboard-Secret header validated on every request.
 */

import Fastify from "fastify";
import type { Client } from "discord.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";
import { claimTx, unclaimTx, ClaimError } from "../features/reviewActions.js";
import { approveTx, approveFlow, deliverApprovalDm } from "../features/review/flows/approve.js";
import { rejectTx, rejectFlow } from "../features/review/flows/reject.js";
import { kickTx, kickFlow } from "../features/review/flows/kick.js";
import { loadApplication } from "../features/review/queries.js";
import { clearClaim, getClaim } from "../features/review/claims.js";
import { updateReviewActionMeta } from "../features/review/queries.js";

// ===== Tier Check =====

const TIER_ORDER = ["owner", "cm", "sa", "admin", "sm", "mod", "jm", "gk", "viewer", "none"];

function hasMinTier(userTier: string, minTier: string): boolean {
  const userIdx = TIER_ORDER.indexOf(userTier);
  const minIdx = TIER_ORDER.indexOf(minTier);
  if (userIdx === -1 || minIdx === -1) return false;
  return userIdx <= minIdx;
}

// ===== Types =====

type ApiSuccess = { success: true; data: Record<string, unknown> };
type ApiError = { success: false; error: string };
type ReviewBody = {
  userId: string;
  tier: string;
  appId: string;
  reason?: string;
};

// ===== Server =====

let server: ReturnType<typeof Fastify> | null = null;

const DASHBOARD_API_PORT = parseInt(process.env.DASHBOARD_API_PORT ?? "3003", 10);
const DASHBOARD_API_SECRET = process.env.DASHBOARD_API_SECRET;
const GUILD_ID = process.env.GUILD_ID!;

export async function startDashboardApi(client: Client): Promise<void> {
  if (!DASHBOARD_API_SECRET) {
    logger.warn("[dashboardApi] DASHBOARD_API_SECRET not set — dashboard API disabled");
    return;
  }

  server = Fastify({ logger: false });

  // Auth hook — validate X-Dashboard-Secret on every request
  server.addHook("onRequest", async (request, reply) => {
    const secret = request.headers["x-dashboard-secret"];
    if (secret !== DASHBOARD_API_SECRET) {
      return reply.code(401).send({ success: false, error: "Unauthorized" } satisfies ApiError);
    }
  });

  // Error handler — no stack traces
  server.setErrorHandler(async (error, _request, reply) => {
    logger.error({ err: error }, "[dashboardApi] Unhandled error");
    reply.code(500).send({ success: false, error: "Internal server error" } satisfies ApiError);
  });

  // Helper to get guild
  function getGuild(): Guild | undefined {
    return client.guilds.cache.get(GUILD_ID);
  }

  // ===== Routes =====

  // POST /api/review/claim
  server.post<{ Body: ReviewBody }>("/api/review/claim", async (request, reply) => {
    const { userId, tier, appId } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    try {
      claimTx(appId, userId, GUILD_ID);
      return { success: true, data: { appId, reviewerId: userId } } satisfies ApiSuccess;
    } catch (err) {
      if (err instanceof ClaimError) {
        const status = err.code === "APP_NOT_FOUND" ? 404 : 409;
        return reply.code(status).send({ success: false, error: err.message } satisfies ApiError);
      }
      throw err;
    }
  });

  // POST /api/review/unclaim
  server.post<{ Body: ReviewBody }>("/api/review/unclaim", async (request, reply) => {
    const { userId, tier, appId } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    // Admin+ can unclaim anyone; GK can only unclaim own
    const claim = getClaim(appId);
    if (!claim) {
      return reply.code(409).send({ success: false, error: "Application is not claimed" } satisfies ApiError);
    }
    const isAdmin = hasMinTier(tier, "admin");
    if (claim.reviewer_id !== userId && !isAdmin) {
      return reply.code(403).send({ success: false, error: "Only the claim owner or an admin can unclaim" } satisfies ApiError);
    }

    if (isAdmin && claim.reviewer_id !== userId) {
      // Admin override: bypass unclaimTx ownership check
      clearClaim(appId);
    } else {
      try {
        unclaimTx(appId, userId, GUILD_ID);
      } catch (err) {
        if (err instanceof ClaimError) {
          const status = err.code === "APP_NOT_FOUND" ? 404 : 409;
          return reply.code(status).send({ success: false, error: err.message } satisfies ApiError);
        }
        throw err;
      }
    }
    return { success: true, data: { appId } } satisfies ApiSuccess;
  });

  // POST /api/review/approve
  server.post<{ Body: ReviewBody }>("/api/review/approve", async (request, reply) => {
    const { userId, tier, appId, reason } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    // Verify claim ownership
    const claim = getClaim(appId);
    if (claim && claim.reviewer_id !== userId) {
      return reply.code(409).send({ success: false, error: "Application is claimed by another reviewer" } satisfies ApiError);
    }

    const txResult = approveTx(appId, userId, reason);
    if (txResult.kind !== "changed") {
      return reply.code(409).send({ success: false, error: "Application is not in a reviewable state" } satisfies ApiError);
    }

    // Clear claim after decision
    clearClaim(appId);

    // Discord side-effects (best-effort, don't block response)
    const guild = getGuild();
    if (guild) {
      const cfg = getConfig(GUILD_ID);
      if (cfg) {
        const flowResult = await approveFlow(guild, app.user_id, cfg);
        if (flowResult.member) {
          await deliverApprovalDm(flowResult.member, guild.name, reason);
        }
        updateReviewActionMeta(txResult.reviewActionId, {
          roleApplied: flowResult.roleApplied,
          dmDelivered: !!flowResult.member,
        });
      }
    }

    return { success: true, data: { appId, action: "approve" } } satisfies ApiSuccess;
  });

  // POST /api/review/reject
  server.post<{ Body: ReviewBody }>("/api/review/reject", async (request, reply) => {
    const { userId, tier, appId, reason } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!reason) return reply.code(400).send({ success: false, error: "Reason is required for rejection" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    const claim = getClaim(appId);
    if (claim && claim.reviewer_id !== userId) {
      return reply.code(409).send({ success: false, error: "Application is claimed by another reviewer" } satisfies ApiError);
    }

    const txResult = rejectTx(appId, userId, reason);
    if (txResult.kind !== "changed") {
      return reply.code(409).send({ success: false, error: "Application is not in a reviewable state" } satisfies ApiError);
    }

    clearClaim(appId);

    // Discord side-effects
    const guild = getGuild();
    if (guild) {
      try {
        const user = await client.users.fetch(app.user_id);
        const flowResult = await rejectFlow(user, { guildName: guild.name, reason });
        updateReviewActionMeta(txResult.reviewActionId, { dmDelivered: flowResult.dmDelivered });
      } catch (err) {
        logger.warn({ err, appId, userId: app.user_id }, "[dashboardApi] Failed to send rejection DM");
      }
    }

    return { success: true, data: { appId, action: "reject" } } satisfies ApiSuccess;
  });

  // POST /api/review/kick
  server.post<{ Body: ReviewBody }>("/api/review/kick", async (request, reply) => {
    const { userId, tier, appId, reason } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!reason) return reply.code(400).send({ success: false, error: "Reason is required for kick" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    const claim = getClaim(appId);
    if (claim && claim.reviewer_id !== userId) {
      return reply.code(409).send({ success: false, error: "Application is claimed by another reviewer" } satisfies ApiError);
    }

    const txResult = kickTx(appId, userId, reason);
    if (txResult.kind !== "changed") {
      return reply.code(409).send({ success: false, error: "Application is not in a reviewable state" } satisfies ApiError);
    }

    clearClaim(appId);

    // Discord side-effects
    const guild = getGuild();
    if (guild) {
      const flowResult = await kickFlow(guild, app.user_id, reason);
      updateReviewActionMeta(txResult.reviewActionId, {
        dmDelivered: flowResult.dmDelivered,
        kickSucceeded: flowResult.kickSucceeded,
        kickError: flowResult.error,
      });
    }

    return { success: true, data: { appId, action: "kick" } } satisfies ApiSuccess;
  });

  // Start server
  await server.listen({ port: DASHBOARD_API_PORT, host: "0.0.0.0" });
  logger.info({ port: DASHBOARD_API_PORT }, "[dashboardApi] Dashboard API started");
}

export async function stopDashboardApi(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    logger.info("[dashboardApi] Dashboard API stopped");
  }
}

export function getDashboardApiPort(): number {
  return DASHBOARD_API_PORT;
}
