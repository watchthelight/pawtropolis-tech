/**
 * Pawtropolis Tech -- src/web/routes/flag.ts
 * WHAT: /api/flag/* dashboard routes.
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { logActionPretty } from "../../logging/pretty.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";
import { notifyDashboard } from "../notifyDashboard.js";
import type { DashboardRouteContext } from "./context.js";

export function registerFlagRoutes(server: FastifyInstance, ctx: DashboardRouteContext): void {
  const { getGuild } = ctx;

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
}
