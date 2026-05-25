/**
 * Pawtropolis Tech -- src/web/routes/modmail.ts
 * WHAT: /api/modmail/* dashboard routes.
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { dashboardSendMessage, dashboardOpenThread, dashboardCloseThread, dashboardReopenThread } from "../../features/modmail.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";
import { notifyDashboard } from "../notifyDashboard.js";
import type { DashboardRouteContext } from "./context.js";

export function registerModmailRoutes(server: FastifyInstance, ctx: DashboardRouteContext): void {
  const { client, getGuild } = ctx;

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
}
