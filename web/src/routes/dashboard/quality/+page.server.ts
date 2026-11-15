/**
 * Pawtropolis Tech -- web/src/routes/dashboard/quality/+page.server.ts
 * WHAT: Loads the Quality page: the scores of the main chat for one window.
 * WHY: Moderators and up read here how the chat is doing. The numbers come
 *      from the score file of the research job. Without that file the page
 *      says that nothing has been scored on this host.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import {
  getAllTimeMeans,
  getAuthorBoards,
  getRecentTrend,
  getScoreStatus,
  getWeeklyMeasures,
  getWindowSummary,
} from "$lib/server/queries/quality";
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
  // The refusal goes out without the cache header. A browser that kept it would go on
  // showing it to someone who was given the role a moment ago.
  if (!locals.user || !hasMinTier(locals.user.tier, "mod")) {
    error(403, "You don't have permission to view this page.");
  }
  setHeaders({ "cache-control": CACHE_HEADERS.default });
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");

  const guildId = process.env.GUILD_ID;
  const spec = parseTimeWindowSpec(url.searchParams, "30d");
  const range = resolveRange(spec);
  const base = { spec, windowLabel: formatWindowLabel(spec), nowS: Math.floor(Date.now() / 1000) };

  // Not cached: it is a few small reads, and the page should notice the score file as soon
  // as the job has written it.
  const status = getScoreStatus();
  if (!status) return { ...base, status: null, scores: null };

  // The job adds a few scores every 15 minutes. A window over the whole history costs two
  // passes over about two million rows, so it is kept for half an hour.
  const scores = await cached(
    cacheKey(["quality:window", guildId, ...rangeCacheKeyParts(range)]),
    CACHE_TTL.veryLong,
    () => ({
      summary: getWindowSummary(range),
      boards: getAuthorBoards(guildId, range),
      measures: getWeeklyMeasures(range),
      trend: getRecentTrend(range.endS),
      allTime: getAllTimeMeans(),
    })
  );

  return { ...base, status, scores };
};
