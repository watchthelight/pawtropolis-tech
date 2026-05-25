/**
 * Pawtropolis Tech -- src/web/dashboardApi.ts
 * WHAT: Fastify server on port 3003 for dashboard mutation requests.
 * WHY: Dashboard UI proxies review actions (claim, approve, reject, kick, unclaim)
 *      through this API. Bot independently verifies tier and executes mutations.
 * AUTH: X-Dashboard-Secret header validated on every request.
 */

import Fastify, { type FastifyInstance } from "fastify";
import type { Client } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";
import { getArtistConfig } from "../features/artistRotation/constants.js";
import { addArtist, removeArtist, moveToPosition, skipArtist, unskipArtist, getNextArtist, logAssignment, processAssignment } from "../features/artistRotation/queue.js";
import { createJob, updateJobStatus, finishJob, cancelJob, getJobById, setJobThumbnail } from "../features/artJobs/store.js";
import type { JobStatus } from "../features/artJobs/types.js";
import type { ArtType } from "../features/artistRotation/constants.js";
import { getRoleTiers } from "../features/roleAutomation.js";
import { loadApplication } from "../features/review/queries.js";
import { logActionPretty } from "../logging/pretty.js";
import { dashboardSendMessage, dashboardOpenThread, dashboardCloseThread, dashboardReopenThread } from "../features/modmail.js";
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

// ===== Tier Check =====
// Tier ordering and the hasMinTier comparator live in src/web/dashboardAuth.ts
// so they can be unit-tested without spinning up Fastify. See
// docs/reference/dashboard-api-security.md for the auth model.

import { hasMinTier } from "./dashboardAuth.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { createRouteContext } from "./routes/context.js";
import { registerReviewRoutes } from "./routes/review.js";

// ===== Types =====

import type { ApiSuccess, ApiError, ReviewBody } from "./dashboardApiTypes.js";

// ===== SSE Notifier =====

import { notifyDashboard } from "./notifyDashboard.js";
import { CONFIG_FIELD_RULES, validateConfigUpdate, normalizeConfigValue, hasMinTier as hasMinTierValidation } from "../lib/configValidation.js";

// ===== Server =====

let server: FastifyInstance | null = null;

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

  // CSRF defense: validate Origin header on state-changing methods. The
  // secret alone is enough for server-to-server calls (no browser Origin),
  // but a logged-in dashboard user could be tricked into POSTing from a
  // malicious origin that still carries the cookie. Block by allowlist.
  //
  // Allowlist source: DASHBOARD_ALLOWED_ORIGINS (comma-separated env var).
  // Defaults to https://pawtropolis.tech for production safety.
  const allowedOrigins = (process.env.DASHBOARD_ALLOWED_ORIGINS ?? "https://pawtropolis.tech")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const stateChanging = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  server.addHook("onRequest", async (request, reply) => {
    if (!stateChanging.has(request.method.toUpperCase())) return;
    const origin = request.headers.origin;
    if (origin === undefined) return; // server-to-server (no browser context), secret already authenticated
    if (!allowedOrigins.includes(origin)) {
      logger.warn({ origin, method: request.method, url: request.url }, "[dashboardApi] blocked cross-origin state change");
      return reply.code(403).send({ success: false, error: "Origin not allowed" } satisfies ApiError);
    }
  });

  // Error handler — no stack traces
  server.setErrorHandler(async (error, _request, reply) => {
    logger.error({ err: error }, "[dashboardApi] Unhandled error");
    reply.code(500).send({ success: false, error: "Internal server error" } satisfies ApiError);
  });

  const ctx = createRouteContext(client);
  const { getGuild, cacheModerator } = ctx;

  // ===== Routes =====

  registerReviewRoutes(server, ctx);

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

  // ───────────────────────────────────────────────────────────────────────
  // QOTD endpoints — dashboard QOTD page actions (approve/reject/use/restore/edit)
  // ───────────────────────────────────────────────────────────────────────

  // POST /api/qotd/approve — approve a pending suggestion
  server.post<{ Body: { userId: string; tier: string; suggestionId: number } }>("/api/qotd/approve", async (request, reply) => {
    const { userId, tier, suggestionId } = request.body ?? {};
    if (!userId || !tier || !suggestionId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const { approveSuggestion, getSuggestionById } = await import("../features/qotd/db.js");
    const ok = approveSuggestion(suggestionId, userId);
    if (!ok) return reply.code(409).send({ success: false, error: "Suggestion not pending or not found" } satisfies ApiError);

    notifyDashboard("qotd:approved", { suggestionId, reviewerId: userId });
    const after = getSuggestionById(suggestionId);
    return { success: true, data: { suggestion: after as unknown as Record<string, unknown> } } satisfies ApiSuccess;
  });

  // POST /api/qotd/reject — reject a pending suggestion (reason required)
  server.post<{ Body: { userId: string; tier: string; suggestionId: number; reason?: string } }>("/api/qotd/reject", async (request, reply) => {
    const { userId, tier, suggestionId, reason } = request.body ?? {};
    if (!userId || !tier || !suggestionId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const safeReason = (reason ?? "Rejected via dashboard").slice(0, 500);
    const { rejectSuggestion, getSuggestionById } = await import("../features/qotd/db.js");
    const ok = rejectSuggestion(suggestionId, userId, safeReason);
    if (!ok) return reply.code(409).send({ success: false, error: "Suggestion not pending or not found" } satisfies ApiError);

    notifyDashboard("qotd:rejected", { suggestionId, reviewerId: userId });
    const after = getSuggestionById(suggestionId);
    return { success: true, data: { suggestion: after as unknown as Record<string, unknown> } } satisfies ApiSuccess;
  });

  // POST /api/qotd/use — mark an approved suggestion as used (records who pulled it)
  server.post<{ Body: { userId: string; tier: string; suggestionId: number } }>("/api/qotd/use", async (request, reply) => {
    const { userId, tier, suggestionId } = request.body ?? {};
    if (!userId || !tier || !suggestionId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const { markSuggestionUsed, getSuggestionById } = await import("../features/qotd/db.js");
    const ok = markSuggestionUsed(suggestionId, userId);
    if (!ok) return reply.code(409).send({ success: false, error: "Suggestion not approved or not found" } satisfies ApiError);

    notifyDashboard("qotd:used", { suggestionId, usedBy: userId });
    const after = getSuggestionById(suggestionId);
    return { success: true, data: { suggestion: after as unknown as Record<string, unknown> } } satisfies ApiSuccess;
  });

  // POST /api/qotd/restore — move a rejected/used suggestion back to approved
  server.post<{ Body: { userId: string; tier: string; suggestionId: number } }>("/api/qotd/restore", async (request, reply) => {
    const { userId, tier, suggestionId } = request.body ?? {};
    if (!userId || !tier || !suggestionId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "sm")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const { restoreSuggestion, getSuggestionById } = await import("../features/qotd/db.js");
    const ok = restoreSuggestion(suggestionId, userId);
    if (!ok) return reply.code(409).send({ success: false, error: "Suggestion not in a restorable state" } satisfies ApiError);

    notifyDashboard("qotd:restored", { suggestionId, reviewerId: userId });
    const after = getSuggestionById(suggestionId);
    return { success: true, data: { suggestion: after as unknown as Record<string, unknown> } } satisfies ApiSuccess;
  });

  // POST /api/qotd/edit — edit pending question text before approval
  server.post<{ Body: { userId: string; tier: string; suggestionId: number; question: string } }>("/api/qotd/edit", async (request, reply) => {
    const { userId, tier, suggestionId, question } = request.body ?? {};
    if (!userId || !tier || !suggestionId || !question) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const trimmed = question.trim().slice(0, 500);
    if (trimmed.length < 4) return reply.code(400).send({ success: false, error: "Question too short (min 4 chars)" } satisfies ApiError);

    const { editSuggestionQuestion, getSuggestionById } = await import("../features/qotd/db.js");
    const ok = editSuggestionQuestion(suggestionId, trimmed);
    if (!ok) return reply.code(409).send({ success: false, error: "Only pending suggestions can be edited" } satisfies ApiError);

    notifyDashboard("qotd:edited", { suggestionId, editorId: userId });
    const after = getSuggestionById(suggestionId);
    return { success: true, data: { suggestion: after as unknown as Record<string, unknown> } } satisfies ApiSuccess;
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

  registerAuditRoutes(server, client);

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

      // Process memory. heapTotal grows lazily so heapUsed/heapTotal hovers
      // near 100% even when there's gigabytes of headroom — report against the
      // V8 heap_size_limit instead so the % is actually meaningful.
      const mem = process.memoryUsage();
      const v8 = await import("node:v8");
      const heapStats = v8.getHeapStatistics();
      const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
      const heapLimitMB = Math.round(heapStats.heap_size_limit / 1024 / 1024);
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

      // Host metrics — gives the dashboard a real ops view, not just a bot view.
      const os = await import("node:os");
      const loadavg = os.loadavg();
      const totalMemBytes = os.totalmem();
      const freeMemBytes = os.freemem();
      const cpuCount = os.cpus().length;
      const hostUptimeS = os.uptime();

      // Cost: EC2 instance + EBS gp3. Tweak via env so resize doesn't need a
      // code edit. Defaults reflect t3.large + 64GB gp3 in us-east-1.
      const HOURLY_USD = parseFloat(process.env.EC2_HOURLY_USD ?? "0.0832");
      const STORAGE_USD_PER_MO = parseFloat(process.env.EC2_STORAGE_USD_PER_MO ?? "5.12");
      const monthlyUsd = HOURLY_USD * 24 * 30.4 + STORAGE_USD_PER_MO;
      const instanceType = process.env.EC2_INSTANCE_TYPE ?? "t3.large";
      const storageGB = parseInt(process.env.EC2_STORAGE_GB ?? "64", 10);

      return {
        success: true,
        data: {
          uptime: Math.round(uptime),
          uptimeFormatted,
          wsPingMs: summary.wsPingMs,
          memory: { heapUsedMB, heapTotalMB, heapLimitMB, rssMB },
          disk,
          activeAlertCount: summary.activeAlerts.length,
          pm2: summary.pm2,
          dbIntegrity: summary.db,
          host: {
            loadavg,
            cpuCount,
            totalMemMB: Math.round(totalMemBytes / 1024 / 1024),
            freeMemMB: Math.round(freeMemBytes / 1024 / 1024),
            usedMemPct: Math.round(((totalMemBytes - freeMemBytes) / totalMemBytes) * 100),
            uptimeS: Math.round(hostUptimeS),
          },
          cost: {
            hourlyUsd: HOURLY_USD,
            dailyUsd: +(HOURLY_USD * 24).toFixed(2),
            monthlyUsd: +monthlyUsd.toFixed(2),
            note: `EC2 ${instanceType} us-east-1 + ${storageGB}GB gp3 (storage flat rate)`,
          },
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
