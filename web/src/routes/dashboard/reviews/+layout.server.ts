import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import { getReviewQueue, getReviewHistory } from "$lib/server/queries/reviews";
import { cached, cacheKey, CACHE_TTL } from "$lib/server/cache";
import type { LayoutServerLoad } from "./$types";

const GUILD_ID = process.env.GUILD_ID!;

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user || !hasMinTier(locals.user.tier, "gk")) {
    error(403, "You don't have permission to view this page.");
  }

  const historyLimit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 10), 100);
  // The queue payload is identical for every reviewer and recomputed on each
  // /dashboard/reviews/* navigation; a short TTL collapses the repeated
  // correlated-subquery scans. Review mutations bust pulse:/stats: via the SSE
  // webhook, and the page re-loads after the short window.
  const queue = await cached(cacheKey(["reviews:queue", GUILD_ID]), CACHE_TTL.short, () =>
    getReviewQueue(GUILD_ID)
  );
  const history = getReviewHistory(GUILD_ID, historyLimit);

  const userId = locals.user.id;
  const unclaimed = queue.filter((item) => !item.claimedBy).length;
  const myClaims = queue.filter((item) => item.claimedBy === userId).length;

  return {
    queue,
    history,
    historyLimit,
    userId,
    tabCounts: {
      unclaimed,
      mine: myClaims,
      all: queue.length,
      history: history.length,
    },
  };
};
