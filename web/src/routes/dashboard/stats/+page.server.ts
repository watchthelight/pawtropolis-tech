import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import {
  getPersonalStats,
  getPersonalStatsTrend,
  getActivityTimeline,
  getResponseTrend,
  getTeamStats,
  getModBreakdowns,
  getDecisionPercentiles,
  getInviteSourceBreakdown,
  getApplicationFunnel,
} from "$lib/server/queries/stats";
import {
  parseTimeWindowSpec,
  resolveRange,
  formatWindowLabel,
  rangeCacheKeyParts,
} from "$lib/shared/timeWindow";
import { cached, cacheKey, CACHE_TTL, CACHE_HEADERS } from "$lib/server/cache";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  setHeaders({ "cache-control": CACHE_HEADERS.default });
  if (!locals.user || !hasMinTier(locals.user.tier, "gk")) {
    error(403, "You don't have permission to view this page.");
  }
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");

  const guildId = process.env.GUILD_ID;
  const userId = locals.user.id;
  const spec = parseTimeWindowSpec(url.searchParams, "all");
  const range = resolveRange(spec);
  const rangeKey = rangeCacheKeyParts(range, 60);

  const personalKey = cacheKey(["stats:personal", userId, guildId, ...rangeKey]);
  const teamKey = cacheKey(["stats:team", guildId, ...rangeKey]);

  const [personalData, teamData] = await Promise.all([
    cached(personalKey, CACHE_TTL.medium, () => ({
      personal: getPersonalStats(userId, guildId, range),
      timeline: getActivityTimeline(userId, guildId, range),
      responseTrend: getResponseTrend(userId, guildId, range),
    })),
    cached(teamKey, CACHE_TTL.medium, () => ({
      team: getTeamStats(guildId, range),
      modBreakdowns: getModBreakdowns(guildId, range),
      decisionPercentiles: getDecisionPercentiles(guildId, range),
      inviteSources: getInviteSourceBreakdown(guildId, range),
      funnel: getApplicationFunnel(guildId, range),
    })),
  ]);
  const trend = await cached(
    cacheKey(["stats:personal-trend", userId, guildId, ...rangeKey]),
    CACHE_TTL.medium,
    () => getPersonalStatsTrend(userId, guildId, range, personalData.personal)
  );

  return {
    ...personalData,
    trend,
    ...teamData,
    spec,
    windowLabel: formatWindowLabel(spec),
    windowDays: range.days,
    userId,
  };
};
