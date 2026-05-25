/**
 * Pawtropolis Tech -- src/web/routes/levelStats.ts
 * WHAT: /api/level-role-stats dashboard route(s).
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { getRoleTiers } from "../../features/roleAutomation.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";
import type { DashboardRouteContext } from "./context.js";

const GUILD_ID = process.env.GUILD_ID!;

export function registerLevelStatsRoutes(server: FastifyInstance, ctx: DashboardRouteContext): void {
  const { getGuild } = ctx;

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
}
