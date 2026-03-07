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
import { closeModmailForApplication, dashboardSendMessage, dashboardOpenThread, dashboardCloseThread, dashboardReopenThread } from "../features/modmail.js";
import { postWelcomeCard } from "../features/welcome.js";
import { shortCode } from "../lib/ids.js";
import { cacheUser, snowflakeToTimestamp } from "../lib/userCache.js";
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";
import type { TextChannel } from "discord.js";

// ===== Tier Check =====

const TIER_ORDER = ["owner", "cm", "cdl", "sa", "admin", "sm", "mod", "jm", "gk", "viewer", "none"];

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

import { notifyDashboard } from "./notifyDashboard.js";

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

  /** Post a confirmation message in the review channel, replying to the review card. */
  async function postReviewChannelMessage(appId: string, content: string, reviewMessageId?: string): Promise<void> {
    try {
      const cfg = getConfig(GUILD_ID);
      const channelId = cfg?.review_channel_id;
      if (!channelId) return;
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;
      await (channel as TextChannel).send({
        content,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
        ...(reviewMessageId ? { reply: { messageReference: reviewMessageId, failIfNotExists: false } } : {}),
      });
    } catch (err) {
      logger.warn({ err, appId }, "[dashboardApi] failed to post review channel message");
    }
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
        const cardResult = await ensureReviewMessage(client, appId).catch((err) => {
          logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after claim");
          return null;
        });
        postReviewChannelMessage(appId, `<@${userId}> has claimed this application.`, cardResult?.messageId);
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
      const cardResult = await ensureReviewMessage(client, appId).catch((err) => {
        logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after unclaim");
        return null;
      });
      postReviewChannelMessage(appId, `<@${userId}> has unclaimed this application.`, cardResult?.messageId);
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

        // BLOCK: If role grant failed, skip DM and welcome so user doesn't think they're verified
        if (cfg.accepted_role_id && !flowResult.roleApplied) {
          const errorReason = flowResult.roleError?.message ?? "Unknown error";
          logger.error(
            { appId, userId: app.user_id, roleError: errorReason },
            "[dashboardApi] BLOCKED: Role grant failed after retries — user left in limbo"
          );
          updateReviewActionMeta(txResult.reviewActionId, { roleApplied: false, dmDelivered: false });
          // Still return success (DB approved) but include the role error for the dashboard to show
          notifyDashboard("review:approved", { appId, reviewerId: userId, action: "approve" });
          notifyDashboard("stats:updated", { userId });
          return reply.code(207).send({
            success: true,
            data: { appId, roleApplied: false, roleError: errorReason },
          } satisfies ApiSuccess);
        }

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

    // Refresh review card in Discord + post confirmation
    const approveCard = await ensureReviewMessage(client, appId).catch((err) => {
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after approve");
      return null;
    });
    postReviewChannelMessage(appId, "Application approved.", approveCard?.messageId);

    cacheModerator(userId);
    notifyDashboard("review:approved", { appId, reviewerId: userId, action: "approve", reason });
    notifyDashboard("stats:updated", { userId });
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

    // Refresh review card in Discord + post confirmation
    const rejectCard = await ensureReviewMessage(client, appId).catch((err) => {
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after reject");
      return null;
    });
    postReviewChannelMessage(appId, "Application rejected.", rejectCard?.messageId);

    cacheModerator(userId);
    notifyDashboard("review:rejected", { appId, reviewerId: userId, action: "reject", reason });
    notifyDashboard("stats:updated", { userId });
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

    // Refresh review card in Discord + post confirmation
    const kickCard = await ensureReviewMessage(client, appId).catch((err) => {
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after kick");
      return null;
    });
    postReviewChannelMessage(appId, "Application kicked.", kickCard?.messageId);

    cacheModerator(userId);
    notifyDashboard("review:kicked", { appId, reviewerId: userId, action: "kick", reason });
    notifyDashboard("stats:updated", { userId });
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

    // Refresh review card in Discord + post confirmation
    const permRejectCard = await ensureReviewMessage(client, appId).catch((err) => {
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after perm_reject");
      return null;
    });
    postReviewChannelMessage(appId, "Application permanently rejected.", permRejectCard?.messageId);

    cacheModerator(userId);
    notifyDashboard("review:permrejected", { appId, reviewerId: userId, action: "perm_reject", reason });
    notifyDashboard("stats:updated", { userId });
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

  // POST /api/review/profile — fetch full Discord profile for an applicant
  server.post<{ Body: { userId: string; tier: string; targetUserId: string } }>("/api/review/profile", async (request, reply) => {
    const { userId, tier, targetUserId } = request.body ?? {};
    if (!userId || !tier || !targetUserId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or targetUserId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    try {
      // Force API call to get banner and accent color (not available from cache)
      const user = await client.users.fetch(targetUserId, { force: true });
      const guild = getGuild();
      const member = guild ? await guild.members.fetch({ user: targetUserId, force: true }).catch(() => null) : null;

      // Cache enriched data
      cacheUser(user, GUILD_ID, member);

      const avatarUrl = member?.displayAvatarURL({ size: 256 }) ?? user.displayAvatarURL({ size: 256 });
      const bannerUrl = user.bannerURL?.({ size: 512 }) ?? null;
      const roles = member
        ? [...member.roles.cache.values()]
            .filter(r => r.id !== guild?.id) // exclude @everyone
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === "#000000" ? null : r.hexColor, position: r.position }))
        : [];

      // Read presence from cache (requires GuildPresences intent)
      const presence = member?.presence ?? guild?.presences.cache.get(targetUserId) ?? null;
      let status: string | null = presence?.status ?? null; // "online" | "idle" | "dnd" | "offline"
      let customStatus: string | null = null;
      if (presence?.activities) {
        const custom = presence.activities.find(a => a.type === 4); // ActivityType.Custom
        if (custom) {
          customStatus = [custom.emoji?.toString(), custom.state].filter(Boolean).join(" ") || null;
        }
      }
      logger.debug({ targetUserId, status, customStatus, activityCount: presence?.activities?.length ?? 0 }, "[dashboardApi] presence data");

      return {
        success: true,
        data: {
          userId: user.id,
          username: user.username,
          globalName: user.globalName,
          displayName: member?.displayName ?? user.globalName ?? user.username,
          avatarUrl,
          bannerUrl,
          accentColor: user.accentColor ?? null,
          joinedAt: member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null,
          createdAt: Math.floor(snowflakeToTimestamp(user.id) / 1000),
          roles,
          status,
          customStatus,
        },
      } satisfies ApiSuccess;
    } catch (err) {
      logger.warn({ err, targetUserId }, "[dashboardApi] failed to fetch user profile");
      return reply.code(404).send({ success: false, error: "User not found" } satisfies ApiError);
    }
  });

  // ===== Modmail Routes =====

  // POST /api/modmail/send — send a message to a user via modmail
  server.post<{ Body: { userId: string; tier: string; ticketId: number; content: string } }>("/api/modmail/send", async (request, reply) => {
    const { userId, tier, ticketId, content } = request.body ?? {};
    if (!userId || !tier || !ticketId || !content) return reply.code(400).send({ success: false, error: "Missing userId, tier, ticketId, or content" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);
    if (content.length > 2000) return reply.code(400).send({ success: false, error: "Message too long (max 2000 characters)" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(500).send({ success: false, error: "Guild not available" } satisfies ApiError);

    const result = await dashboardSendMessage({ client, guild, staffUserId: userId, ticketId, content });
    if (!result.success) {
      return reply.code(400).send({ success: false, error: result.error ?? "Failed to send" } satisfies ApiError);
    }

    notifyDashboard("modmail:message_sent", { ticketId, staffUserId: userId });
    return { success: true, data: { ticketId } } satisfies ApiSuccess;
  });

  // POST /api/modmail/open — open a new modmail thread
  server.post<{ Body: { userId: string; tier: string; targetUserId: string; appCode?: string } }>("/api/modmail/open", async (request, reply) => {
    const { userId, tier, targetUserId, appCode } = request.body ?? {};
    if (!userId || !tier || !targetUserId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or targetUserId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(500).send({ success: false, error: "Guild not available" } satisfies ApiError);

    const result = await dashboardOpenThread({ client, guild, staffUserId: userId, targetUserId, appCode });
    if (!result.success) {
      const status = result.error?.includes("already has") ? 409 : 400;
      return reply.code(status).send({ success: false, error: result.error ?? "Failed to open" } satisfies ApiError);
    }

    notifyDashboard("modmail:thread_opened", { ticketId: result.ticketId, threadId: result.threadId, targetUserId, staffUserId: userId });
    return { success: true, data: { ticketId: result.ticketId, threadId: result.threadId } } satisfies ApiSuccess;
  });

  // POST /api/modmail/close — close an open modmail thread
  server.post<{ Body: { userId: string; tier: string; ticketId: number } }>("/api/modmail/close", async (request, reply) => {
    const { userId, tier, ticketId } = request.body ?? {};
    if (!userId || !tier || !ticketId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or ticketId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(500).send({ success: false, error: "Guild not available" } satisfies ApiError);

    const result = await dashboardCloseThread({ client, guild, staffUserId: userId, ticketId });
    if (!result.success) {
      const status = result.error?.includes("not found") ? 404 : result.error?.includes("already closed") ? 409 : 400;
      return reply.code(status).send({ success: false, error: result.error ?? "Failed to close" } satisfies ApiError);
    }

    notifyDashboard("modmail:thread_closed", { ticketId, staffUserId: userId });
    return { success: true, data: { ticketId, logUrl: result.logUrl } } satisfies ApiSuccess;
  });

  // POST /api/modmail/reopen — reopen a closed modmail thread
  server.post<{ Body: { userId: string; tier: string; ticketId: number } }>("/api/modmail/reopen", async (request, reply) => {
    const { userId, tier, ticketId } = request.body ?? {};
    if (!userId || !tier || !ticketId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or ticketId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(500).send({ success: false, error: "Guild not available" } satisfies ApiError);

    const result = await dashboardReopenThread({ client, guild, staffUserId: userId, ticketId });
    if (!result.success) {
      const status = result.error?.includes("not found") ? 404 : result.error?.includes("already open") ? 409 : 400;
      return reply.code(status).send({ success: false, error: result.error ?? "Failed to reopen" } satisfies ApiError);
    }

    notifyDashboard("modmail:thread_reopened", { ticketId, threadId: result.threadId, staffUserId: userId });
    return { success: true, data: { ticketId, threadId: result.threadId } } satisfies ApiSuccess;
  });

  // POST /api/flag/kick — kick a flagged user from the guild
  server.post<{ Body: { userId: string; tier: string; targetUserId: string; reason?: string } }>("/api/flag/kick", async (request, reply) => {
    const { userId, tier, targetUserId, reason } = request.body ?? {};
    if (!userId || !tier || !targetUserId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(500).send({ success: false, error: "Guild not available" } satisfies ApiError);

    try {
      const member = await guild.members.fetch(targetUserId).catch(() => null);
      if (!member) return reply.code(404).send({ success: false, error: "Member not found in guild" } satisfies ApiError);

      await member.kick(reason ?? "Kicked via dashboard flag triage");
      logger.info({ moderatorId: userId, targetUserId, reason }, "[dashboardApi] Flagged user kicked");
      notifyDashboard("flag:kicked", { userId: targetUserId, kickedBy: userId });
      return { success: true, data: { targetUserId } } satisfies ApiSuccess;
    } catch (err) {
      logger.warn({ err, targetUserId }, "[dashboardApi] flag kick failed");
      return reply.code(500).send({ success: false, error: "Failed to kick member" } satisfies ApiError);
    }
  });

  // POST /api/flag/dismiss — dismiss a flag (NSFW or behavioral)
  server.post<{ Body: { userId: string; tier: string; targetUserId: string; flagType: 'nsfw' | 'behavioral' } }>("/api/flag/dismiss", async (request, reply) => {
    const { userId, tier, targetUserId, flagType } = request.body ?? {};
    if (!userId || !tier || !targetUserId || !flagType) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(500).send({ success: false, error: "Guild not available" } satisfies ApiError);

    try {
      if (flagType === "nsfw") {
        const result = db.prepare("UPDATE nsfw_flags SET reviewed = 1, reviewed_by = ?, reviewed_at = datetime('now') WHERE guild_id = ? AND user_id = ?").run(userId, guild.id, targetUserId);
        if (result.changes === 0) return reply.code(404).send({ success: false, error: "NSFW flag not found" } satisfies ApiError);
      } else {
        const result = db.prepare("UPDATE user_activity SET flagged_at = NULL, flagged_reason = NULL, manual_flag = 0, flagged_by = NULL WHERE guild_id = ? AND user_id = ? AND flagged_at IS NOT NULL").run(guild.id, targetUserId);
        if (result.changes === 0) return reply.code(404).send({ success: false, error: "Behavioral flag not found" } satisfies ApiError);
      }
    } catch (err) {
      logger.warn({ err, targetUserId, flagType }, "[dashboardApi] flag dismiss failed");
      return reply.code(500).send({ success: false, error: "Database error" } satisfies ApiError);
    }

    logger.info({ moderatorId: userId, targetUserId, flagType }, "[dashboardApi] Flag dismissed");

    // Audit trail — every other action logs, dismiss should too
    logActionPretty(guild, {
      actorId: userId,
      subjectId: targetUserId,
      action: "flag_dismissed",
      meta: { flagType },
    }).catch((err) => logger.warn({ err, targetUserId }, "[dashboardApi] failed to log flag dismiss"));

    notifyDashboard("flag:dismissed", { userId: targetUserId, flagType });
    return { success: true, data: { targetUserId, flagType } } satisfies ApiSuccess;
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
