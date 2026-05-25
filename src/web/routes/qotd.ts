/**
 * Pawtropolis Tech -- src/web/routes/qotd.ts
 * WHAT: /api/qotd/* dashboard routes.
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";
import { notifyDashboard } from "../notifyDashboard.js";
import type { DashboardRouteContext } from "./context.js";

export function registerQotdRoutes(server: FastifyInstance, _ctx: DashboardRouteContext): void {
  // POST /api/qotd/approve — approve a pending suggestion
  server.post<{ Body: { userId: string; tier: string; suggestionId: number } }>("/api/qotd/approve", async (request, reply) => {
    const { userId, tier, suggestionId } = request.body ?? {};
    if (!userId || !tier || !suggestionId) return reply.code(400).send({ success: false, error: "Missing required fields" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const { approveSuggestion, getSuggestionById } = await import("../../features/qotd/db.js");
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
    const { rejectSuggestion, getSuggestionById } = await import("../../features/qotd/db.js");
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

    const { markSuggestionUsed, getSuggestionById } = await import("../../features/qotd/db.js");
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

    const { restoreSuggestion, getSuggestionById } = await import("../../features/qotd/db.js");
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

    const { editSuggestionQuestion, getSuggestionById } = await import("../../features/qotd/db.js");
    const ok = editSuggestionQuestion(suggestionId, trimmed);
    if (!ok) return reply.code(409).send({ success: false, error: "Only pending suggestions can be edited" } satisfies ApiError);

    notifyDashboard("qotd:edited", { suggestionId, editorId: userId });
    const after = getSuggestionById(suggestionId);
    return { success: true, data: { suggestion: after as unknown as Record<string, unknown> } } satisfies ApiSuccess;
  });
}
