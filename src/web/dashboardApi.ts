/**
 * Pawtropolis Tech -- src/web/dashboardApi.ts
 * WHAT: Fastify server on port 3003 for dashboard mutation requests.
 * WHY: Dashboard UI proxies review actions (claim, approve, reject, kick, unclaim)
 *      through this API. Bot independently verifies tier and executes mutations.
 * AUTH: X-Dashboard-Secret header validated on every request.
 */

import Fastify from "fastify";
import type { Client, Guild } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";
import { getArtistConfig } from "../features/artistRotation/constants.js";
import { addArtist, removeArtist, moveToPosition, skipArtist, unskipArtist, getNextArtist, logAssignment, processAssignment } from "../features/artistRotation/queue.js";
import { createJob, updateJobStatus, finishJob, cancelJob, getJobById, setJobThumbnail } from "../features/artJobs/store.js";
import type { JobStatus } from "../features/artJobs/types.js";
import type { ArtType } from "../features/artistRotation/constants.js";
import { nowUtc } from "../lib/time.js";
import { claimTx, unclaimTx, ClaimError } from "../features/reviewActions.js";
import { getRoleTiers } from "../features/roleAutomation.js";
import { approveTx, approveFlow, deliverApprovalDm } from "../features/review/flows/approve.js";
import { rejectTx, rejectFlow } from "../features/review/flows/reject.js";
import { kickTx, kickFlow } from "../features/review/flows/kick.js";
import { loadApplication, insertVoteOut, getVoteOutVoters } from "../features/review/queries.js";
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
import { CONFIG_FIELD_RULES, validateConfigUpdate, normalizeConfigValue, hasMinTier as hasMinTierValidation } from "../lib/configValidation.js";

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
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    const claim = getClaim(appId);
    if (claim && claim.reviewer_id !== userId) {
      return reply.code(409).send({ success: false, error: "Application is claimed by another reviewer" } satisfies ApiError);
    }

    const rejectReason = (reason as string) || "No reason given, try a new application";
    const txResult = rejectTx(appId, userId, rejectReason);
    if (txResult.kind !== "changed") {
      return reply.code(409).send({ success: false, error: "Application is not in a reviewable state" } satisfies ApiError);
    }

    // Note: Claim preserved for review card "handled by" attribution

    // Discord side-effects
    const guild = getGuild();
    if (guild) {
      try {
        const user = await client.users.fetch(app.user_id);
        const flowResult = await rejectFlow(user, { guildName: guild.name, reason: rejectReason });
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

  // POST /api/review/wrong_password
  server.post<{ Body: ReviewBody }>("/api/review/wrong_password", async (request, reply) => {
    const { userId, tier, appId } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    const claim = getClaim(appId);
    if (claim && claim.reviewer_id !== userId) {
      return reply.code(409).send({ success: false, error: "Application is claimed by another reviewer" } satisfies ApiError);
    }

    const rejectReason = "That is not the right password, which you can find by reading the rules carefully! It's hidden well on purpose. Please fill out a new application with the correct password.";
    const txResult = rejectTx(appId, userId, rejectReason);
    if (txResult.kind !== "changed") {
      return reply.code(409).send({ success: false, error: "Application is not in a reviewable state" } satisfies ApiError);
    }

    const guild = getGuild();
    if (guild) {
      try {
        const user = await client.users.fetch(app.user_id);
        const tryAgainRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("v1:start")
            .setLabel("Try Again")
            .setStyle(ButtonStyle.Success)
        );
        const flowResult = await rejectFlow(user, { guildName: guild.name, reason: rejectReason, components: [tryAgainRow] });
        updateReviewActionMeta(txResult.reviewActionId, { dmDelivered: flowResult.dmDelivered });
      } catch (err) {
        logger.warn({ err, appId, userId: app.user_id }, "[dashboardApi] Failed to send wrong_password rejection DM");
      }

      const code = shortCode(appId);
      logActionPretty(guild, { appId, appCode: code, actorId: userId, subjectId: app.user_id, action: "reject", reason: rejectReason }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to log wrong_password reject action"));

      closeModmailForApplication(guild.id, app.user_id, code, { reason: "rejected", client, guild }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to auto-close modmail on wrong_password reject"));
    }

    const wpCard = await ensureReviewMessage(client, appId).catch((err) => {
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after wrong_password reject");
      return null;
    });
    postReviewChannelMessage(appId, "Application rejected (wrong password).", wpCard?.messageId);

    cacheModerator(userId);
    notifyDashboard("review:rejected", { appId, reviewerId: userId, action: "reject", reason: rejectReason });
    notifyDashboard("stats:updated", { userId });
    return { success: true, data: { appId, action: "wrong_password" } } satisfies ApiSuccess;
  });

  // POST /api/review/stale_modmail
  server.post<{ Body: ReviewBody }>("/api/review/stale_modmail", async (request, reply) => {
    const { userId, tier, appId } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    const claim = getClaim(appId);
    if (claim && claim.reviewer_id !== userId) {
      return reply.code(409).send({ success: false, error: "Application is claimed by another reviewer" } satisfies ApiError);
    }

    const rejectReason = "User did not respond to modmail in < 24 hours. Please try again.";
    const txResult = rejectTx(appId, userId, rejectReason);
    if (txResult.kind !== "changed") {
      return reply.code(409).send({ success: false, error: "Application is not in a reviewable state" } satisfies ApiError);
    }

    const guild = getGuild();
    if (guild) {
      try {
        const user = await client.users.fetch(app.user_id);
        const tryAgainRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("v1:start")
            .setLabel("Try Again")
            .setStyle(ButtonStyle.Success)
        );
        const flowResult = await rejectFlow(user, { guildName: guild.name, reason: rejectReason, components: [tryAgainRow] });
        updateReviewActionMeta(txResult.reviewActionId, { dmDelivered: flowResult.dmDelivered });
      } catch (err) {
        logger.warn({ err, appId, userId: app.user_id }, "[dashboardApi] Failed to send stale_modmail rejection DM");
      }

      const code = shortCode(appId);
      logActionPretty(guild, { appId, appCode: code, actorId: userId, subjectId: app.user_id, action: "reject", reason: rejectReason }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to log stale_modmail reject action"));

      closeModmailForApplication(guild.id, app.user_id, code, { reason: "rejected", client, guild }).catch((err) =>
        logger.warn({ err, appId }, "[dashboardApi] failed to auto-close modmail on stale_modmail reject"));
    }

    const staleCard = await ensureReviewMessage(client, appId).catch((err) => {
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh review card after stale_modmail reject");
      return null;
    });
    postReviewChannelMessage(appId, "Application rejected (stale modmail).", staleCard?.messageId);

    cacheModerator(userId);
    notifyDashboard("review:rejected", { appId, reviewerId: userId, action: "reject", reason: rejectReason });
    notifyDashboard("stats:updated", { userId });
    return { success: true, data: { appId, action: "stale_modmail" } } satisfies ApiSuccess;
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

  // POST /api/review/vote_out
  server.post<{ Body: ReviewBody }>("/api/review/vote_out", async (request, reply) => {
    const { userId, tier, appId } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    // Terminal guard — no voting on resolved applications
    if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
      return reply.code(409).send({ success: false, error: "Application is already resolved" } satisfies ApiError);
    }

    // NO claim guard — any GK can vote regardless of claim status

    // Insert vote (idempotent via UNIQUE constraint)
    const isNew = insertVoteOut(app.id, userId);
    if (!isNew) {
      return reply.code(409).send({ success: false, error: "You already voted on this application" } satisfies ApiError);
    }

    // Log vote action in review_action audit trail
    try {
      db.prepare(
        `INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, message_link, meta)
         VALUES (?, ?, 'vote_out', ?, NULL, NULL, NULL)`
      ).run(app.id, userId, nowUtc());
    } catch (err) {
      logger.error({ err, appId: app.id }, "[dashboardApi] failed to log vote_out action");
    }

    // Fetch current voters and threshold
    const voters = getVoteOutVoters(app.id);
    const cfg = getConfig(GUILD_ID);
    const threshold = cfg?.vote_out_threshold ?? 2;

    cacheModerator(userId);

    // Threshold not met — refresh card and return vote status
    if (voters.length < threshold) {
      await ensureReviewMessage(client, appId).catch((err) => {
        logger.warn({ err, appId }, "[dashboardApi] failed to refresh card after vote_out");
      });
      notifyDashboard("review:vote_out", { appId, reviewerId: userId, voteCount: voters.length, threshold });
      return { success: true, data: { appId, action: "vote_out", voteCount: voters.length, threshold, thresholdMet: false } } satisfies ApiSuccess;
    }

    // === Threshold met — execute rejection ===
    const rejectionReason = "Staff has decided to deny your application at this time. Thank you, and have a nice day.";

    const txResult = db.transaction(() => {
      const row = db.prepare(`SELECT status FROM application WHERE id = ?`).get(app.id) as { status: string } | undefined;
      if (!row) throw new Error("Application not found");
      if (row.status === "rejected") return { kind: "already" as const, status: row.status };
      if (row.status === "approved" || row.status === "kicked") return { kind: "terminal" as const, status: row.status };
      db.prepare(
        `UPDATE application
         SET status = 'rejected', updated_at = datetime('now'), resolved_at = datetime('now'),
             resolver_id = ?, resolution_reason = ?
         WHERE id = ?`
      ).run(userId, "Voted out by staff", app.id);
      return { kind: "changed" as const };
    })();

    if (txResult.kind === "already") {
      return reply.code(409).send({ success: false, error: "Already rejected" } satisfies ApiError);
    }
    if (txResult.kind === "terminal") {
      return reply.code(409).send({ success: false, error: `Already resolved (${txResult.status})` } satisfies ApiError);
    }

    // Discord side-effects
    const guild = getGuild();
    if (guild) {
      const code = shortCode(appId);

      // Log to logging channel
      logActionPretty(guild, {
        appId: app.id, appCode: code, actorId: userId,
        subjectId: app.user_id, action: "vote_out", reason: "Voted out by staff",
      }).catch((err) => logger.warn({ err, appId }, "[dashboardApi] failed to log vote_out rejection"));

      // Auto-close modmail
      closeModmailForApplication(guild.id, app.user_id, code, {
        reason: "voted out", client, guild,
      }).catch((err) => logger.warn({ err, appId }, "[dashboardApi] failed to auto-close modmail on vote out"));

      // Send rejection DM
      try {
        const user = await client.users.fetch(app.user_id);
        await rejectFlow(user, { guildName: guild.name, reason: rejectionReason });
      } catch (err) {
        logger.warn({ err, appId, userId: app.user_id }, "[dashboardApi] Failed to send vote out DM");
      }
    }

    // Refresh review card + post public voter list
    const cardResult = await ensureReviewMessage(client, appId).catch((err) => {
      logger.warn({ err, appId }, "[dashboardApi] failed to refresh card after vote out rejection");
      return null;
    });

    const mentions = voters.map((id) => `<@${id}>`);
    let voterList: string;
    if (mentions.length === 1) voterList = mentions[0];
    else if (mentions.length === 2) voterList = `${mentions[0]} and ${mentions[1]}`;
    else voterList = `${mentions.slice(0, -1).join(", ")}, and ${mentions[mentions.length - 1]}`;
    postReviewChannelMessage(appId, `${voterList} voted <@${app.user_id}> out.`, cardResult?.messageId);

    notifyDashboard("review:rejected", { appId, reviewerId: userId, action: "vote_out" });
    notifyDashboard("stats:updated", { userId });
    return { success: true, data: { appId, action: "vote_out", voteCount: voters.length, threshold, thresholdMet: true } } satisfies ApiSuccess;
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
          memberInServer: member !== null,
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

  // ── Audit: Start Scan ───────────────────────────────────────────
  server.post<{ Body: Record<string, unknown> }>("/api/audit/scan/start", async (request, reply) => {
    const { userId, tier, auditType, scope } = request.body ?? {};
    if (!userId || !tier || !auditType)
      return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "admin"))
      return reply.code(403).send({ success: false, error: "Insufficient permissions (admin+ required)" } satisfies ApiError);
    if (auditType !== "members" && auditType !== "nsfw")
      return reply.code(400).send({ success: false, error: "auditType must be 'members' or 'nsfw'" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(503).send({ success: false, error: "Bot not ready" } satisfies ApiError);

    const { getActiveSession } = await import("../store/auditSessionStore.js");
    const active = getActiveSession(guild.id, auditType as "members" | "nsfw");
    if (active)
      return reply.code(409).send({ success: false, error: `A ${auditType} scan is already running (session ${active.id})` } satisfies ApiError);

    // Trigger the scan in the background — returns session ID immediately
    const { triggerMemberScan, triggerNsfwScan } = await import("../features/auditRunner.js");
    let sessionId: number;

    if (auditType === "members") {
      sessionId = triggerMemberScan(guild, userId as string);
    } else {
      const nsfwScope = (scope === "flagged" ? "flagged" : "all") as "all" | "flagged";
      sessionId = triggerNsfwScan(guild, userId as string, nsfwScope);
    }

    return { success: true, data: { sessionId } } satisfies ApiSuccess;
  });

  // ── Audit: Cancel Scan ─────────────────────────────────────────
  server.post<{ Body: Record<string, unknown> }>("/api/audit/scan/cancel", async (request, reply) => {
    const { userId, tier, auditType } = request.body ?? {};
    if (!userId || !tier || !auditType)
      return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "admin"))
      return reply.code(403).send({ success: false, error: "Insufficient permissions (admin+ required)" } satisfies ApiError);

    const guild = getGuild();
    if (!guild) return reply.code(503).send({ success: false, error: "Bot not ready" } satisfies ApiError);

    const { getActiveSession, cancelSession } = await import("../store/auditSessionStore.js");
    const active = getActiveSession(guild.id, auditType as string);
    if (!active)
      return reply.code(404).send({ success: false, error: `No active ${auditType} scan found` } satisfies ApiError);

    cancelSession(active.id);
    notifyDashboard("audit:scan_cancelled", { sessionId: active.id, auditType });
    return { success: true, data: { sessionId: active.id } } satisfies ApiSuccess;
  });

  // ── Audit: Acknowledge Security Issue ──────────────────────────
  server.post<{ Body: Record<string, unknown> }>("/api/audit/acknowledge", async (request, reply) => {
    const { userId, tier, issueKey, severity, title, permissionHash, reason } = request.body ?? {};
    if (!userId || !tier || !issueKey || !severity || !title || !permissionHash)
      return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sa"))
      return reply.code(403).send({ success: false, error: "Insufficient permissions (sa+ required)" } satisfies ApiError);

    const { acknowledgeIssue } = await import("../store/acknowledgedSecurityStore.js");
    acknowledgeIssue({
      guildId: guild.id,
      issueKey: issueKey as string,
      severity: severity as string,
      title: title as string,
      permissionHash: permissionHash as string,
      acknowledgedBy: userId as string,
      reason: reason as string | undefined,
    });

    notifyDashboard("audit:issue_acknowledged", { issueKey, acknowledgedBy: userId });
    return { success: true, data: { issueKey } } satisfies ApiSuccess;
  });

  // ── Audit: Unacknowledge Security Issue ────────────────────────
  server.post<{ Body: Record<string, unknown> }>("/api/audit/unacknowledge", async (request, reply) => {
    const { userId, tier, issueKey } = request.body ?? {};
    if (!userId || !tier || !issueKey)
      return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sa"))
      return reply.code(403).send({ success: false, error: "Insufficient permissions (sa+ required)" } satisfies ApiError);

    const { unacknowledgeIssue } = await import("../store/acknowledgedSecurityStore.js");
    const removed = unacknowledgeIssue(guild.id, issueKey as string);
    if (!removed) return reply.code(404).send({ success: false, error: "Issue was not acknowledged" } satisfies ApiError);

    notifyDashboard("audit:issue_unacknowledged", { issueKey });
    return { success: true, data: { issueKey } } satisfies ApiSuccess;
  });

  // ===== Art Routes =====

  /** Post a message to the server artist channel (best-effort, fire-and-forget). */
  async function postArtistChannelEmbed(embed: EmbedBuilder): Promise<void> {
    try {
      const artistCfg = getArtistConfig(GUILD_ID);
      const channelId = artistCfg.serverArtistChannelId;
      if (!channelId) return;
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;
      await (channel as import("discord.js").TextChannel).send({ embeds: [embed], allowedMentions: SAFE_ALLOWED_MENTIONS });
    } catch { /* fire-and-forget */ }
  }

  // POST /api/art/queue/add — add artist to queue end
  server.post<{ Body: Record<string, unknown> }>("/api/art/queue/add", async (request, reply) => {
    const { userId: actorId, tier, targetUserId } = request.body ?? {};
    if (!actorId || !tier || !targetUserId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions (sm+ required)" } satisfies ApiError);

    const position = addArtist(GUILD_ID, targetUserId as string);
    if (position === null) {
      return reply.code(409).send({ success: false, error: "Artist already in queue" } satisfies ApiError);
    }

    notifyDashboard("art:queue_updated", { action: "add", userId: targetUserId });
    postArtistChannelEmbed(new EmbedBuilder().setColor(0x5865f2).setDescription(`<@${targetUserId}> added to the artist queue at position ${position}.`)).catch((err) => { logger.warn({ err }, "[dashboardApi] post artist-added embed failed"); });
    return { success: true, data: { userId: targetUserId, position } } satisfies ApiSuccess;
  });

  // POST /api/art/queue/remove — remove artist from queue
  server.post<{ Body: Record<string, unknown> }>("/api/art/queue/remove", async (request, reply) => {
    const { userId: actorId, tier, targetUserId } = request.body ?? {};
    if (!actorId || !tier || !targetUserId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions (sm+ required)" } satisfies ApiError);

    const assignments = removeArtist(GUILD_ID, targetUserId as string);
    if (assignments === null) {
      return reply.code(404).send({ success: false, error: "Artist not in queue" } satisfies ApiError);
    }

    notifyDashboard("art:queue_updated", { action: "remove", userId: targetUserId });
    postArtistChannelEmbed(new EmbedBuilder().setColor(0xed4245).setDescription(`<@${targetUserId}> removed from the artist queue.`)).catch((err) => { logger.warn({ err }, "[dashboardApi] post artist-removed embed failed"); });
    return { success: true, data: { userId: targetUserId } } satisfies ApiSuccess;
  });

  // POST /api/art/queue/reorder — move artist to new position
  server.post<{ Body: Record<string, unknown> }>("/api/art/queue/reorder", async (request, reply) => {
    const { userId: actorId, tier, targetUserId, newPosition } = request.body ?? {};
    if (!actorId || !tier || !targetUserId || newPosition === undefined) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions (sm+ required)" } satisfies ApiError);

    const ok = moveToPosition(GUILD_ID, targetUserId as string, Number(newPosition));
    if (!ok) return reply.code(404).send({ success: false, error: "Artist not in queue" } satisfies ApiError);

    notifyDashboard("art:queue_updated", { action: "reorder", userId: targetUserId, newPosition });
    return { success: true, data: { userId: targetUserId, newPosition } } satisfies ApiSuccess;
  });

  // POST /api/art/queue/skip — skip artist with optional reason
  server.post<{ Body: Record<string, unknown> }>("/api/art/queue/skip", async (request, reply) => {
    const { userId: actorId, tier, targetUserId, reason } = request.body ?? {};
    if (!actorId || !tier || !targetUserId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions (sm+ required)" } satisfies ApiError);

    const ok = skipArtist(GUILD_ID, targetUserId as string, reason as string | undefined);
    if (!ok) return reply.code(404).send({ success: false, error: "Artist not in queue" } satisfies ApiError);

    notifyDashboard("art:queue_updated", { action: "skip", userId: targetUserId, reason });
    postArtistChannelEmbed(new EmbedBuilder().setColor(0xfee75c).setDescription(`<@${targetUserId}> has been skipped in the artist queue${reason ? `: ${reason}` : "."}`)).catch((err) => { logger.warn({ err }, "[dashboardApi] post artist-skipped embed failed"); });
    return { success: true, data: { userId: targetUserId } } satisfies ApiSuccess;
  });

  // POST /api/art/queue/unskip — resume skipped artist
  server.post<{ Body: Record<string, unknown> }>("/api/art/queue/unskip", async (request, reply) => {
    const { userId: actorId, tier, targetUserId } = request.body ?? {};
    if (!actorId || !tier || !targetUserId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions (sm+ required)" } satisfies ApiError);

    const ok = unskipArtist(GUILD_ID, targetUserId as string);
    if (!ok) return reply.code(404).send({ success: false, error: "Artist not in queue or not skipped" } satisfies ApiError);

    notifyDashboard("art:queue_updated", { action: "unskip", userId: targetUserId });
    postArtistChannelEmbed(new EmbedBuilder().setColor(0x57f287).setDescription(`<@${targetUserId}> is back in the artist queue rotation.`)).catch((err) => { logger.warn({ err }, "[dashboardApi] post artist-unskipped embed failed"); });
    return { success: true, data: { userId: targetUserId } } satisfies ApiSuccess;
  });

  // POST /api/art/jobs/create — create new assignment
  server.post<{ Body: Record<string, unknown> }>("/api/art/jobs/create", async (request, reply) => {
    const { userId: actorId, tier, artistId, recipientId, ticketType, notes } = request.body ?? {};
    if (!actorId || !tier || !artistId || !recipientId || !ticketType) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions (sm+ required)" } satisfies ApiError);

    const ART_TYPES: ArtType[] = ["headshot", "halfbody", "emoji", "fullbody"];
    if (!ART_TYPES.includes(ticketType as ArtType)) {
      return reply.code(400).send({ success: false, error: `Invalid ticketType. Must be one of: ${ART_TYPES.join(", ")}` } satisfies ApiError);
    }

    // Resolve artist: 'next' triggers queue rotation
    let resolvedArtistId: string;
    let isOverride = false;

    if (artistId === "next") {
      const next = getNextArtist(GUILD_ID);
      if (!next) return reply.code(409).send({ success: false, error: "No available artists in queue" } satisfies ApiError);
      resolvedArtistId = next.userId;
    } else {
      resolvedArtistId = artistId as string;
      isOverride = true;
    }

    // Log assignment and process queue rotation
    const logId = logAssignment({
      guildId: GUILD_ID,
      artistId: resolvedArtistId,
      recipientId: recipientId as string,
      ticketType: ticketType as ArtType,
      ticketRoleId: null,
      assignedBy: actorId as string,
      channelId: null,
      override: isOverride,
    });

    // Process queue rotation (move to end + increment assignments)
    processAssignment(GUILD_ID, resolvedArtistId);

    // Create the job
    const job = createJob({
      guildId: GUILD_ID,
      artistId: resolvedArtistId,
      recipientId: recipientId as string,
      ticketType: ticketType as ArtType,
      assignmentLogId: logId,
    });

    // Update notes if provided
    if (notes) {
      updateJobStatus(job.id, { notes: notes as string });
    }

    notifyDashboard("art:job_created", { jobId: job.id, jobNumber: job.jobNumber, artistId: resolvedArtistId, recipientId });
    notifyDashboard("art:queue_updated", { action: "assigned", userId: resolvedArtistId });
    postArtistChannelEmbed(
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(`📋 New assignment: **${ticketType}** for <@${recipientId}> → assigned to <@${resolvedArtistId}> (job #${String(job.jobNumber).padStart(4, "0")})`)
    ).catch((err) => { logger.warn({ err }, "[dashboardApi] post job-created embed failed"); });

    return { success: true, data: { jobId: job.id, jobNumber: job.jobNumber, artistJobNumber: job.artistJobNumber, artistId: resolvedArtistId } } satisfies ApiSuccess;
  });

  // POST /api/art/jobs/status — update job stage
  server.post<{ Body: Record<string, unknown> }>("/api/art/jobs/status", async (request, reply) => {
    const { userId: actorId, tier, jobId, status } = request.body ?? {};
    if (!actorId || !tier || !jobId || !status) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);

    const VALID_STATUSES = ["assigned", "sketching", "lining", "coloring"];
    if (!VALID_STATUSES.includes(status as string)) {
      return reply.code(400).send({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` } satisfies ApiError);
    }

    const job = getJobById(Number(jobId));
    if (!job) return reply.code(404).send({ success: false, error: "Job not found" } satisfies ApiError);

    // Artists can update their own jobs; staff (sm+) can update any
    const isOwner = job.artist_id === actorId;
    const isStaff = hasMinTier(tier as string, "sm");
    if (!isOwner && !isStaff) return reply.code(403).send({ success: false, error: "Can only update your own jobs" } satisfies ApiError);

    const ok = updateJobStatus(Number(jobId), { status: status as JobStatus });
    if (!ok) return reply.code(409).send({ success: false, error: "Failed to update job status" } satisfies ApiError);

    notifyDashboard("art:job_updated", { jobId, status, artistId: job.artist_id });

    const statusColors: Record<string, number> = {
      assigned: 0x5865f2, sketching: 0x4f8af0, lining: 0x9b59b6, coloring: 0xe91e8c,
    };
    postArtistChannelEmbed(
      new EmbedBuilder()
        .setColor(statusColors[status as string] ?? 0x5865f2)
        .setDescription(`<@${job.artist_id}> updated job **#${String(job.job_number).padStart(4, "0")}** → ${status}`)
    ).catch((err) => { logger.warn({ err }, "[dashboardApi] post job-status-update embed failed"); });

    return { success: true, data: { jobId, status } } satisfies ApiSuccess;
  });

  // POST /api/art/jobs/finish — mark job done
  server.post<{ Body: Record<string, unknown> }>("/api/art/jobs/finish", async (request, reply) => {
    const { userId: actorId, tier, jobId } = request.body ?? {};
    if (!actorId || !tier || !jobId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);

    const job = getJobById(Number(jobId));
    if (!job) return reply.code(404).send({ success: false, error: "Job not found" } satisfies ApiError);

    const isOwner = job.artist_id === actorId;
    const isStaff = hasMinTier(tier as string, "sm");
    if (!isOwner && !isStaff) return reply.code(403).send({ success: false, error: "Can only finish your own jobs" } satisfies ApiError);

    const ok = finishJob(Number(jobId));
    if (!ok) return reply.code(409).send({ success: false, error: "Failed to finish job" } satisfies ApiError);

    notifyDashboard("art:job_finished", { jobId, artistId: job.artist_id, recipientId: job.recipient_id });
    postArtistChannelEmbed(
      new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(`✅ <@${job.artist_id}> completed job **#${String(job.job_number).padStart(4, "0")}** for <@${job.recipient_id}> (${job.ticket_type})`)
    ).catch((err) => { logger.warn({ err }, "[dashboardApi] post job-finished embed failed"); });

    return { success: true, data: { jobId } } satisfies ApiSuccess;
  });

  // POST /api/art/jobs/thumbnail — set the thumbnail URL for a job (called after file upload)
  server.post<{ Body: Record<string, unknown> }>("/api/art/jobs/thumbnail", async (request, reply) => {
    const { userId: actorId, tier, jobId, thumbnailUrl } = request.body ?? {};
    if (!actorId || !tier || !jobId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);

    const job = getJobById(Number(jobId));
    if (!job) return reply.code(404).send({ success: false, error: "Job not found" } satisfies ApiError);

    // Artists can update thumbnails on their own jobs; staff can update any
    const isOwner = job.artist_id === actorId;
    const isStaff = hasMinTier(tier as string, "sm");
    if (!isOwner && !isStaff) return reply.code(403).send({ success: false, error: "Can only update thumbnails on your own jobs" } satisfies ApiError);

    const ok = setJobThumbnail(Number(jobId), thumbnailUrl as string | null);
    if (!ok) return reply.code(409).send({ success: false, error: "Failed to update thumbnail" } satisfies ApiError);

    notifyDashboard("art:job_thumbnail", { jobId, artistId: job.artist_id, thumbnailUrl });
    return { success: true, data: { jobId, thumbnailUrl } } satisfies ApiSuccess;
  });

  // POST /api/art/jobs/cancel — cancel job with optional reason
  server.post<{ Body: Record<string, unknown> }>("/api/art/jobs/cancel", async (request, reply) => {
    const { userId: actorId, tier, jobId, reason } = request.body ?? {};
    if (!actorId || !tier || !jobId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier as string, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions (sm+ required)" } satisfies ApiError);

    const job = getJobById(Number(jobId));
    if (!job) return reply.code(404).send({ success: false, error: "Job not found" } satisfies ApiError);

    const ok = cancelJob(Number(jobId), reason as string | undefined);
    if (!ok) return reply.code(409).send({ success: false, error: "Cannot cancel this job (already done?)" } satisfies ApiError);

    notifyDashboard("art:job_cancelled", { jobId, artistId: job.artist_id });
    postArtistChannelEmbed(
      new EmbedBuilder()
        .setColor(0xed4245)
        .setDescription(`❌ Job **#${String(job.job_number).padStart(4, "0")}** cancelled${reason ? `: ${reason}` : "."}`)
    ).catch((err) => { logger.warn({ err }, "[dashboardApi] post job-cancelled embed failed"); });

    return { success: true, data: { jobId } } satisfies ApiSuccess;
  });

  // ===== Image Scan Routes =====

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
      const { scanAvatar, upsertFullScan } = await import("../features/avatarScan.js");
      const avatarResult = await scanAvatar(avatarUrl);

      // Scan banner NSFW (if exists)
      let bannerResult: { finalPct: number; nsfwScore: number | null; reason: string; evidence: { hard: any[]; soft: any[]; safe: any[] } } | null = null;
      if (bannerUrl) {
        const { detectNsfwVision, calculateVisionScore } = await import("../features/googleVision.js");
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

      const { detectAIForImage } = await import("../features/aiDetection/index.js");

      // Scan avatar AI
      const avatarAi = await detectAIForImage(avatarUrl, "avatar", GUILD_ID);

      // Scan banner AI (if exists)
      let bannerAi: Awaited<ReturnType<typeof detectAIForImage>> | null = null;
      if (bannerUrl) {
        bannerAi = await detectAIForImage(bannerUrl, "banner", GUILD_ID);
      }

      // Store scores
      const { updateAiScores } = await import("../features/avatarScan.js");

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

  // ===== Level Role Stats =====

  // In-memory cache for level role stats (avoid fetching all members on every page load)
  let levelRoleStatsCache: { data: Record<string, unknown>; fetchedAt: number } | null = null;
  const LEVEL_ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // POST /api/level-role-stats — level role distribution for the pulse page
  server.post<{ Body: { userId: string; tier: string } }>("/api/level-role-stats", async (request, reply) => {
    const { userId, tier } = request.body ?? {};
    if (!userId || !tier) return reply.code(400).send({ success: false, error: "Missing userId, tier" } satisfies ApiError);
    if (!hasMinTier(tier, "mod")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    // Return cached data if fresh
    if (levelRoleStatsCache && Date.now() - levelRoleStatsCache.fetchedAt < LEVEL_ROLE_CACHE_TTL_MS) {
      return { success: true, data: levelRoleStatsCache.data } satisfies ApiSuccess;
    }

    const guild = getGuild();
    if (!guild) return reply.code(503).send({ success: false, error: "Guild not available" } satisfies ApiError);

    try {
      const tiers = getRoleTiers(GUILD_ID, "level");
      // Deduplicate by role_id (DB may have multiple entries for the same Discord role)
      const seen = new Set<string>();
      const uniqueTiers = tiers.filter((t) => {
        if (seen.has(t.role_id)) return false;
        seen.add(t.role_id);
        return true;
      });
      if (uniqueTiers.length === 0) {
        return { success: true, data: { roles: [], totalMembers: guild.memberCount } } satisfies ApiSuccess;
      }

      // Fetch all members via gateway for accurate counts
      const members = await guild.members.fetch();
      const totalMembers = members.size;

      const roles = uniqueTiers
        .map((t) => {
          const role = guild.roles.cache.get(t.role_id);
          const count = members.filter((m) => m.roles.cache.has(t.role_id)).size;
          return {
            tierName: t.tier_name,
            roleId: t.role_id,
            roleName: role?.name ?? t.tier_name,
            color: role?.hexColor && role.hexColor !== "#000000" ? role.hexColor : null,
            threshold: t.threshold,
            count,
          };
        })
        .sort((a, b) => b.threshold - a.threshold); // highest level first

      const data = { roles, totalMembers };
      levelRoleStatsCache = { data, fetchedAt: Date.now() };
      return { success: true, data } satisfies ApiSuccess;
    } catch (err) {
      logger.warn({ err }, "[dashboardApi] Failed to fetch level role stats");
      return reply.code(500).send({ success: false, error: "Failed to fetch level role stats" } satisfies ApiError);
    }
  });

  // ===== Config Update =====

  server.post<{ Body: Record<string, unknown> }>("/api/config/update", async (request, reply) => {
    const { userId, tier, fields } = request.body ?? {};
    if (!userId || !tier || !fields || typeof fields !== "object" || Object.keys(fields as object).length === 0)
      return reply.code(400).send({ success: false, error: "Missing required fields (userId, tier, fields)" } satisfies ApiError);

    // Floor check: admin+ minimum
    if (!hasMinTier(tier as string, "admin"))
      return reply.code(403).send({ success: false, error: "Insufficient permissions (admin+ required)" } satisfies ApiError);

    const fieldEntries = fields as Record<string, unknown>;
    const fieldKeys = Object.keys(fieldEntries);

    // Per-field tier check
    for (const key of fieldKeys) {
      const rule = CONFIG_FIELD_RULES[key];
      if (!rule) {
        return reply.code(400).send({ success: false, error: `Unknown config field: ${key}` } satisfies ApiError);
      }
      if (!hasMinTierValidation(tier as string, rule.minTier)) {
        return reply.code(403).send({
          success: false,
          error: `Insufficient permissions for field '${rule.label}' (requires ${rule.minTier}+)`,
        } satisfies ApiError);
      }
    }

    // Validate all field values
    const validation = validateConfigUpdate(fieldEntries);
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0];
      return reply.code(400).send({ success: false, error: firstError } satisfies ApiError);
    }

    // Read current values for audit trail
    const currentConfig = getConfig(GUILD_ID) as Record<string, unknown> | undefined;

    // Normalize values before writing
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fieldEntries)) {
      normalized[key] = normalizeConfigValue(key, value);
    }

    // Write to database
    try {
      const { upsertConfig } = await import("../lib/config.js");
      upsertConfig(GUILD_ID, normalized);
    } catch (err) {
      logger.error({ err, fields: fieldKeys }, "[dashboardApi] Config update failed");
      return reply.code(500).send({ success: false, error: "Failed to update config" } satisfies ApiError);
    }

    // Audit trail
    try {
      const insertAudit = db.prepare(`
        INSERT INTO config_audit_log (guild_id, user_id, field_key, old_value, new_value, source)
        VALUES (?, ?, ?, ?, ?, 'dashboard')
      `);
      const auditTx = db.transaction(() => {
        for (const key of fieldKeys) {
          const oldVal = currentConfig?.[key] ?? null;
          const newVal = normalized[key] ?? null;
          insertAudit.run(GUILD_ID, userId, key, oldVal == null ? null : String(oldVal), newVal == null ? null : String(newVal));
        }
      });
      auditTx();
    } catch (err) {
      // Audit failure is non-fatal — log and continue
      logger.warn({ err }, "[dashboardApi] Config audit log write failed (non-fatal)");
    }

    logger.info(
      { evt: "config_updated_dashboard", userId, fields: fieldKeys },
      `[dashboardApi] Config updated via dashboard: ${fieldKeys.join(", ")}`
    );

    await cacheModerator(userId as string);
    notifyDashboard("config:updated", { fields: fieldKeys, updatedBy: userId });

    return { success: true, data: { updatedFields: fieldKeys } } satisfies ApiSuccess;
  });

  // ===== System Health =====

  server.post("/api/dashboard/health", async (request, reply) => {
    const body = request.body as { userId?: string; tier?: string } | null;
    if (!body?.userId || !body?.tier) {
      return reply.code(400).send({ success: false, error: "Missing userId or tier" } satisfies ApiError);
    }
    if (!hasMinTier(body.tier, "owner")) {
      return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);
    }

    try {
      const { getSummary } = await import("../features/opsHealth.js");
      const summary = await getSummary(GUILD_ID);

      // Process memory
      const mem = process.memoryUsage();
      const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);

      // Disk space (Linux)
      let disk = { usedGB: 0, totalGB: 0, percentUsed: 0 };
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        const { stdout: dfOutput } = await execFileAsync("df", ["-B1", "/"], { timeout: 3000 });
        const lines = dfOutput.trim().split("\n");
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const totalBytes = parseInt(parts[1], 10);
          const usedBytes = parseInt(parts[2], 10);
          disk = {
            totalGB: Math.round(totalBytes / 1024 / 1024 / 1024 * 10) / 10,
            usedGB: Math.round(usedBytes / 1024 / 1024 / 1024 * 10) / 10,
            percentUsed: Math.round((usedBytes / totalBytes) * 100),
          };
        }
      } catch {
        // Disk info unavailable (Windows dev, non-Linux, etc.)
      }

      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const uptimeFormatted = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      return {
        success: true,
        data: {
          uptime: Math.round(uptime),
          uptimeFormatted,
          wsPingMs: summary.wsPingMs,
          memory: { heapUsedMB, heapTotalMB, rssMB },
          disk,
          activeAlertCount: summary.activeAlerts.length,
          pm2: summary.pm2,
          dbIntegrity: summary.db,
        },
      } satisfies ApiSuccess;
    } catch (err) {
      logger.warn({ err }, "[dashboardApi] Failed to fetch health summary");
      return reply.code(500).send({ success: false, error: "Failed to fetch health data" } satisfies ApiError);
    }
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
