/**
 * Pawtropolis Tech -- src/web/dashboardApi.ts
 * WHAT: Fastify server on port 3003 for dashboard mutation requests.
 * WHY: Dashboard UI proxies review actions (claim, approve, reject, kick, unclaim)
 *      through this API. Bot independently verifies tier and executes mutations.
 * AUTH: X-Dashboard-Secret header validated on every request.
 */

import Fastify from "fastify";
import type { Client, Guild } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";
import { nowUtc } from "../lib/time.js";
import { claimTx, unclaimTx, ClaimError } from "../features/reviewActions.js";
import { approveTx, approveFlow, deliverApprovalDm } from "../features/review/flows/approve.js";
import { rejectTx, rejectFlow } from "../features/review/flows/reject.js";
import { kickTx, kickFlow } from "../features/review/flows/kick.js";
import { loadApplication } from "../features/review/queries.js";
import { getClaim } from "../features/review/claims.js";
import { updateReviewActionMeta } from "../features/review/queries.js";
import { ensureReviewMessage } from "../features/review.js";
import { logActionPretty } from "../logging/pretty.js";
import { closeModmailForApplication } from "../features/modmail.js";
import { postWelcomeCard } from "../features/welcome.js";
import { shortCode } from "../lib/ids.js";
import { cacheUser } from "../lib/userCache.js";

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

// ===== SSE Notifier =====

const DASHBOARD_WEB_URL = process.env.DASHBOARD_WEB_URL || "http://localhost:3000";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

/** Fire-and-forget SSE event to dashboard. Never blocks the mutation response. */
function notifyDashboard(type: string, payload: Record<string, unknown>): void {
  if (!INTERNAL_SECRET) return;
  fetch(`${DASHBOARD_WEB_URL}/api/internal/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
    body: JSON.stringify({ type, payload, timestamp: Date.now() }),
  }).catch((err) => logger.warn({ err, type }, "[dashboardApi] SSE notify failed"));
}

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

  /** Best-effort cache of moderator identity for dashboard display. */
  async function cacheModerator(userId: string): Promise<void> {
    try {
      const user = await client.users.fetch(userId);
      const guild = getGuild();
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      cacheUser(user, GUILD_ID, member);
    } catch { /* best-effort */ }
  }

  // ===== Routes =====

  // POST /api/review/claim
  server.post<{ Body: ReviewBody }>("/api/review/claim", async (request, reply) => {
    const { userId, tier, appId } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    // Check for permanent rejection before claiming
    const app = loadApplication(appId);
    if (app) {
      const permCheck = db
        .prepare("SELECT permanently_rejected FROM application WHERE guild_id = ? AND user_id = ? AND permanently_rejected = 1")
        .get(GUILD_ID, app.user_id) as { permanently_rejected: number } | undefined;
      if (permCheck) {
        return reply.code(409).send({ success: false, error: "This user has been permanently rejected and cannot reapply" } satisfies ApiError);
      }
    }

    try {
      claimTx(appId, userId, GUILD_ID);

      // Discord side-effects: refresh review card + audit log
      const guild = getGuild();
      if (guild) {
        ensureReviewMessage(client, appId).catch((err) =>
          logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after claim"));
        logActionPretty(guild, { appId, appCode: shortCode(appId), actorId: userId, subjectId: app?.user_id ?? "", action: "claim" }).catch((err) =>
          logger.warn({ err, appId }, "[dashboardApi] failed to log claim action"));
      }

      cacheModerator(userId);
      notifyDashboard("review:claimed", { appId, reviewerId: userId });
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
      // clearClaim doesn't insert audit trail, so we do it manually
      db.prepare("DELETE FROM review_claim WHERE app_id = ?").run(appId);
      db.prepare(
        "INSERT INTO review_action (app_id, moderator_id, action, created_at, meta) VALUES (?, ?, 'unclaim', ?, ?)"
      ).run(appId, userId, nowUtc(), JSON.stringify({ type: "admin_override", previousClaimer: claim.reviewer_id }));
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
    // Discord side-effects: refresh review card + audit log
    const guild = getGuild();
    if (guild) {
      const appForLog = loadApplication(appId);
      ensureReviewMessage(client, appId).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after unclaim"));
      logActionPretty(guild, { appId, appCode: shortCode(appId), actorId: userId, subjectId: appForLog?.user_id ?? "", action: "unclaim" }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to log unclaim action"));
    }

    cacheModerator(userId);
    notifyDashboard("review:unclaimed", { appId, reviewerId: userId });
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

    // Note: Claim preserved for review card "handled by" attribution

    // Discord side-effects (best-effort, don't block response)
    const guild = getGuild();
    if (guild) {
      const cfg = getConfig(GUILD_ID);
      if (cfg) {
        const flowResult = await approveFlow(guild, app.user_id, cfg);
        let dmDelivered = false;
        if (flowResult.member) {
          dmDelivered = await deliverApprovalDm(flowResult.member, guild.name, reason);
        }
        updateReviewActionMeta(txResult.reviewActionId, {
          roleApplied: flowResult.roleApplied,
          dmDelivered,
        });

        // Post welcome card (matching actionRunners.ts approve flow)
        if (flowResult.member && (cfg.accepted_role_id ? flowResult.roleApplied : true)) {
          try {
            await postWelcomeCard({ guild, user: flowResult.member, config: cfg, memberCount: guild.memberCount });
          } catch (err) {
            logger.warn({ err, appId }, "[dashboardApi] failed to post welcome card");
          }
        }
      }

      // Audit log + logging channel embed
      const code = shortCode(appId);
      logActionPretty(guild, { appId, appCode: code, actorId: userId, subjectId: app.user_id, action: "approve" }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to log approve action"));

      // Auto-close modmail
      closeModmailForApplication(guild.id, app.user_id, code, { reason: "approved", client, guild }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to auto-close modmail on approve"));
    }

    // Refresh review card in Discord
    ensureReviewMessage(client, appId).catch((err) =>
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after approve"));

    cacheModerator(userId);
    notifyDashboard("review:approved", { appId, reviewerId: userId, action: "approve", reason });
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

    // Note: Claim preserved for review card "handled by" attribution

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

      // Audit log + logging channel embed
      const code = shortCode(appId);
      logActionPretty(guild, { appId, appCode: code, actorId: userId, subjectId: app.user_id, action: "reject", reason }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to log reject action"));

      // Auto-close modmail
      closeModmailForApplication(guild.id, app.user_id, code, { reason: "rejected", client, guild }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to auto-close modmail on reject"));
    }

    // Refresh review card in Discord
    ensureReviewMessage(client, appId).catch((err) =>
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after reject"));

    cacheModerator(userId);
    notifyDashboard("review:rejected", { appId, reviewerId: userId, action: "reject", reason });
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

    // Note: Claim preserved for review card "handled by" attribution

    // Discord side-effects
    const guild = getGuild();
    if (guild) {
      const flowResult = await kickFlow(guild, app.user_id, reason);
      updateReviewActionMeta(txResult.reviewActionId, {
        dmDelivered: flowResult.dmDelivered,
        kickSucceeded: flowResult.kickSucceeded,
        kickError: flowResult.error,
      });

      // Audit log + logging channel embed
      const code = shortCode(appId);
      logActionPretty(guild, { appId, appCode: code, actorId: userId, subjectId: app.user_id, action: "kick", reason }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to log kick action"));

      // Auto-close modmail
      closeModmailForApplication(guild.id, app.user_id, code, { reason: "kicked", client, guild }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to auto-close modmail on kick"));
    }

    // Refresh review card in Discord
    ensureReviewMessage(client, appId).catch((err) =>
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after kick"));

    cacheModerator(userId);
    notifyDashboard("review:kicked", { appId, reviewerId: userId, action: "kick", reason });
    return { success: true, data: { appId, action: "kick" } } satisfies ApiSuccess;
  });

  // POST /api/review/permreject
  server.post<{ Body: ReviewBody }>("/api/review/permreject", async (request, reply) => {
    const { userId, tier, appId, reason } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!reason) return reply.code(400).send({ success: false, error: "Reason is required for permanent rejection" } satisfies ApiError);
    if (!hasMinTier(tier, "admin")) return reply.code(403).send({ success: false, error: "Insufficient permissions (admin+ required)" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    const claim = getClaim(appId);
    if (claim && claim.reviewer_id !== userId) {
      return reply.code(409).send({ success: false, error: "Application is claimed by another reviewer" } satisfies ApiError);
    }

    const txResult = rejectTx(appId, userId, reason, true); // permanent = true
    if (txResult.kind !== "changed") {
      return reply.code(409).send({ success: false, error: "Application is not in a reviewable state" } satisfies ApiError);
    }

    // Note: Claim preserved for review card "handled by" attribution

    // Discord side-effects
    const guild = getGuild();
    if (guild) {
      try {
        const user = await client.users.fetch(app.user_id);
        const flowResult = await rejectFlow(user, { guildName: guild.name, reason, permanent: true });
        updateReviewActionMeta(txResult.reviewActionId, { dmDelivered: flowResult.dmDelivered });
      } catch (err) {
        logger.warn({ err, appId, userId: app.user_id }, "[dashboardApi] Failed to send perm rejection DM");
      }

      // Audit log + logging channel embed
      const code = shortCode(appId);
      logActionPretty(guild, { appId, appCode: code, actorId: userId, subjectId: app.user_id, action: "perm_reject", reason }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to log perm_reject action"));

      // Auto-close modmail
      closeModmailForApplication(guild.id, app.user_id, code, { reason: "permanently rejected", client, guild }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to auto-close modmail on perm_reject"));
    }

    // Refresh review card in Discord
    ensureReviewMessage(client, appId).catch((err) =>
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after perm_reject"));

    cacheModerator(userId);
    notifyDashboard("review:permrejected", { appId, reviewerId: userId, action: "perm_reject", reason });
    return { success: true, data: { appId, action: "perm_reject" } } satisfies ApiSuccess;
  });

  // POST /api/users/resolve — batch resolve user identities for dashboard display
  server.post<{ Body: { userId: string; tier: string; targetUserIds: string[] } }>("/api/users/resolve", async (request, reply) => {
    const { userId, tier, targetUserIds } = request.body ?? {};
    if (!userId || !tier || !targetUserIds?.length) return reply.code(400).send({ success: false, error: "Missing userId, tier, or targetUserIds" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);
    if (targetUserIds.length > 50) return reply.code(400).send({ success: false, error: "Max 50 user IDs per request" } satisfies ApiError);

    const guild = getGuild();
    const resolved: Array<{ userId: string; username: string; globalName: string | null; displayName: string; avatarUrl: string | null }> = [];

    for (const targetId of targetUserIds) {
      try {
        const user = await client.users.fetch(targetId);
        const member = guild ? await guild.members.fetch(targetId).catch(() => null) : null;
        cacheUser(user, GUILD_ID, member);
        const avatarUrl = member?.displayAvatarURL({ size: 128 }) ?? user.displayAvatarURL({ size: 128 });
        resolved.push({
          userId: targetId,
          username: user.username,
          globalName: user.globalName,
          displayName: member?.displayName ?? user.globalName ?? user.username,
          avatarUrl,
        });
      } catch {
        // User may have deleted account or left all mutual servers
        resolved.push({ userId: targetId, username: `User ${targetId.slice(-6)}`, globalName: null, displayName: `User ${targetId.slice(-6)}`, avatarUrl: null });
      }
    }

    return { success: true, data: { users: resolved } } satisfies ApiSuccess;
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
