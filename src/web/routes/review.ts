/**
 * Pawtropolis Tech -- src/web/routes/review.ts
 * WHAT: /api/review/* dashboard routes (claim, unclaim, approve, reject,
 *       wrong_password, stale_modmail, kick, permreject, vote_out) plus
 *       /api/users/resolve and /api/review/profile.
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "../../lib/config.js";
import { nowUtc } from "../../lib/time.js";
import { claimTx, unclaimTx, ClaimError } from "../../features/reviewActions.js";
import { approveTx, approveFlow, deliverApprovalDm } from "../../features/review/flows/approve.js";
import { rejectTx, rejectFlow } from "../../features/review/flows/reject.js";
import { kickTx, kickFlow } from "../../features/review/flows/kick.js";
import { loadApplication, insertVoteOut, getVoteOutVoters, getVoteOutEntries } from "../../features/review/queries.js";
import { getClaim } from "../../features/review/claims.js";
import { updateReviewActionMeta } from "../../features/review/queries.js";
import { ensureReviewMessage } from "../../features/review.js";
import { logActionPretty } from "../../logging/pretty.js";
import { closeModmailForApplication } from "../../features/modmail.js";
import { postWelcomeCard } from "../../features/welcome.js";
import { shortCode } from "../../lib/ids.js";
import { cacheUser, snowflakeToTimestamp } from "../../lib/userCache.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError, ReviewBody } from "../dashboardApiTypes.js";
import { notifyDashboard } from "../notifyDashboard.js";
import type { DashboardRouteContext } from "./context.js";

const GUILD_ID = process.env.GUILD_ID!;

export function registerReviewRoutes(server: FastifyInstance, ctx: DashboardRouteContext): void {
  const { client, getGuild, cacheModerator, postReviewChannelMessage } = ctx;

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

        // BLOCK: If role grant failed, skip DM and welcome so user doesn't think they're verified.
        // Distinguish two cases:
        //   (a) user already left the server (Discord 10007 Unknown Member) — common race
        //       between application approval and the applicant leaving. Not actionable, log
        //       at WARN level with a clear message instead of ERROR + "left in limbo".
        //   (b) any other failure — actually broken, needs manual intervention. Log at ERROR.
        if (cfg.accepted_role_id && !flowResult.roleApplied) {
          const rawErr = flowResult.roleError as { code?: number; message?: string } | undefined;
          const errCode = rawErr?.code;
          const userLeft = errCode === 10007;
          const errorReason =
            rawErr?.message ?? (errCode ? `Discord error ${errCode}` : "Unknown error");

          if (userLeft) {
            logger.warn(
              { appId, userId: app.user_id, errCode },
              "[dashboardApi] role grant skipped — applicant left the server before approval completed"
            );
          } else {
            logger.error(
              { appId, userId: app.user_id, roleError: errorReason, errCode },
              "[dashboardApi] role grant failed after retries — applicant may need a manual role grant"
            );
          }
          updateReviewActionMeta(txResult.reviewActionId, { roleApplied: false, dmDelivered: false });
          // Still return success (DB approved) but include the role error for the dashboard to show
          notifyDashboard("review:approved", { appId, reviewerId: userId, action: "approve" });
          notifyDashboard("stats:updated", { userId });
          return reply.code(207).send({
            success: true,
            data: { appId, roleApplied: false, roleError: errorReason, userLeft },
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
    const { userId, tier, appId, reason: rawReason } = request.body ?? {};
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const voteReason = (rawReason ?? "").trim().slice(0, 300);
    if (!voteReason) {
      return reply.code(400).send({ success: false, error: "Vote out requires a reason (max 300 chars)" } satisfies ApiError);
    }

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    // Terminal guard — no voting on resolved applications
    if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
      return reply.code(409).send({ success: false, error: "Application is already resolved" } satisfies ApiError);
    }

    // NO claim guard — any GK can vote regardless of claim status

    // Insert vote (idempotent via UNIQUE constraint)
    const isNew = insertVoteOut(app.id, userId, voteReason);
    if (!isNew) {
      return reply.code(409).send({ success: false, error: "You already voted on this application" } satisfies ApiError);
    }

    // Log vote action in review_action audit trail (reason included)
    try {
      db.prepare(
        `INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, message_link, meta)
         VALUES (?, ?, 'vote_out', ?, ?, NULL, NULL)`
      ).run(app.id, userId, nowUtc(), voteReason);
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
      notifyDashboard("review:vote_out", { appId, reviewerId: userId, voteCount: voters.length, threshold, reason: voteReason });
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
    if (mentions.length === 1) voterList = mentions[0]!;
    else if (mentions.length === 2) voterList = `${mentions[0]} and ${mentions[1]}`;
    else voterList = `${mentions.slice(0, -1).join(", ")}, and ${mentions[mentions.length - 1]}`;

    const entries = getVoteOutEntries(appId);
    const reasonLines = entries
      .filter((e) => e.reason && e.reason.trim().length > 0)
      .map((e) => `- <@${e.voter_id}>: ${e.reason}`)
      .join("\n");
    const publicMessage = reasonLines
      ? `${voterList} voted <@${app.user_id}> out.\n${reasonLines}`
      : `${voterList} voted <@${app.user_id}> out.`;
    postReviewChannelMessage(appId, publicMessage, cardResult?.messageId);

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
}
