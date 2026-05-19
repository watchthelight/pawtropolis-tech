import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import { getHeatmapDataForRange } from "$lib/server/queries/heatmap";
import { parseTimeWindowSpec, resolveRange, formatWindowLabel } from "$lib/shared/timeWindow";
import { cached, cacheKey, CACHE_TTL, CACHE_HEADERS } from "$lib/server/cache";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  setHeaders({ "cache-control": CACHE_HEADERS.default });
  if (!locals.user || !hasMinTier(locals.user.tier, "sm")) {
    error(403, "You don't have permission to view this page.");
  }
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID required");

  const guildId = process.env.GUILD_ID;
  const spec = parseTimeWindowSpec(url.searchParams, "7d");
  const range = resolveRange(spec);
  const key = cacheKey(["heatmap", guildId, range.startS, range.endS]);

  return cached(key, CACHE_TTL.medium, () => ({
    heatmap: getHeatmapDataForRange(guildId, range),
    spec,
    windowLabel: formatWindowLabel(spec),
  }));
};
