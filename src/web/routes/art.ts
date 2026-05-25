/**
 * Pawtropolis Tech -- src/web/routes/art.ts
 * WHAT: /api/art/* dashboard routes — artist queue (add/remove/reorder/skip/
 *       unskip) and art jobs (create/status/finish/thumbnail/cancel).
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import { getArtistConfig } from "../../features/artistRotation/constants.js";
import { addArtist, removeArtist, moveToPosition, skipArtist, unskipArtist, getNextArtist, logAssignment, processAssignment } from "../../features/artistRotation/queue.js";
import { createJob, updateJobStatus, finishJob, cancelJob, getJobById, setJobThumbnail } from "../../features/artJobs/store.js";
import type { JobStatus } from "../../features/artJobs/types.js";
import type { ArtType } from "../../features/artistRotation/constants.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";
import { notifyDashboard } from "../notifyDashboard.js";
import type { DashboardRouteContext } from "./context.js";

const GUILD_ID = process.env.GUILD_ID!;

export function registerArtRoutes(server: FastifyInstance, ctx: DashboardRouteContext): void {
  const { client } = ctx;

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
}
