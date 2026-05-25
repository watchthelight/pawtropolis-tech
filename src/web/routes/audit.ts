/**
 * Pawtropolis Tech -- src/web/routes/audit.ts
 * WHAT: /api/audit/* dashboard routes (scan start/cancel, security issue
 *       acknowledge/unacknowledge).
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import type { Client, Guild } from "discord.js";
import { hasMinTier } from "../dashboardAuth.js";
import { notifyDashboard } from "../notifyDashboard.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";

const GUILD_ID = process.env.GUILD_ID!;

export function registerAuditRoutes(server: FastifyInstance, client: Client): void {
  const getGuild = (): Guild | undefined => client.guilds.cache.get(GUILD_ID);

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

    const { getActiveSession } = await import("../../store/auditSessionStore.js");
    const active = getActiveSession(guild.id, auditType as "members" | "nsfw");
    if (active)
      return reply.code(409).send({ success: false, error: `A ${auditType} scan is already running (session ${active.id})` } satisfies ApiError);

    // Trigger the scan in the background — returns session ID immediately
    const { triggerMemberScan, triggerNsfwScan } = await import("../../features/auditRunner.js");
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

    const { getActiveSession, cancelSession } = await import("../../store/auditSessionStore.js");
    const active = getActiveSession(guild.id, auditType as "members" | "nsfw");
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

    const guild = getGuild();
    if (!guild) return reply.code(503).send({ success: false, error: "Bot not ready" } satisfies ApiError);

    const { acknowledgeIssue } = await import("../../store/acknowledgedSecurityStore.js");
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

    const guild = getGuild();
    if (!guild) return reply.code(503).send({ success: false, error: "Bot not ready" } satisfies ApiError);

    const { unacknowledgeIssue } = await import("../../store/acknowledgedSecurityStore.js");
    const removed = unacknowledgeIssue(guild.id, issueKey as string);
    if (!removed) return reply.code(404).send({ success: false, error: "Issue was not acknowledged" } satisfies ApiError);

    notifyDashboard("audit:issue_unacknowledged", { issueKey });
    return { success: true, data: { issueKey } } satisfies ApiSuccess;
  });
}
