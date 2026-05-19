import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import {
  getPulseMetrics,
  getNewsletterStats,
  getInsights,
  getGuildSnapshot,
  getTopVoiceChannels,
  getChannelActivityRanking,
  getLevelRoleStats,
  getEngagementWindow,
} from "$lib/server/queries/pulse";
import {
  parseTimeWindowSpec,
  resolveRange,
  formatWindowLabel,
  rangeCacheKeyParts,
} from "$lib/shared/timeWindow";
import { cached, cacheKey, CACHE_TTL, CACHE_HEADERS } from "$lib/server/cache";
import type { PageServerLoad } from "./$types";

export const config = { isr: false };

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  setHeaders({ "cache-control": CACHE_HEADERS.default });
  if (!locals.user || !hasMinTier(locals.user.tier, "mod")) {
    error(403, "You don't have permission to view this page.");
  }
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");

  const guildId = process.env.GUILD_ID;
  const spec = parseTimeWindowSpec(url.searchParams, "7d");
  const range = resolveRange(spec);
  const rangeKey = rangeCacheKeyParts(range, 60);
  const guildKey = cacheKey(["pulse:guild", guildId, ...rangeKey]);

  const guildData = await cached(guildKey, CACHE_TTL.medium, () => ({
    metrics: getPulseMetrics(guildId, range),
    newsletterStats: getNewsletterStats(guildId, range),
    insights: getInsights(guildId, range),
    guildSnapshot: getGuildSnapshot(guildId),
    topVoiceChannels: getTopVoiceChannels(guildId, range),
    channelRanking: getChannelActivityRanking(guildId, range),
    engagement: getEngagementWindow(guildId, range),
  }));

  const levelRoleStats = await getLevelRoleStats(locals.user.id, locals.user.tier).catch(
    () => null
  );

  return {
    ...guildData,
    levelRoleStats,
    spec,
    windowLabel: formatWindowLabel(spec),
  };
};
