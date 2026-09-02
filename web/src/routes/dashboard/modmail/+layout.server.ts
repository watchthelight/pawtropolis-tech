import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import { getModmailThreads, getModmailStats } from "$lib/server/queries/modmail";
import { cached, cacheKey, CACHE_TTL } from "$lib/server/cache";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user || !hasMinTier(locals.user.tier, "gk")) {
    error(403, "You don't have permission to view this page.");
  }
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");

  const guildId = process.env.GUILD_ID;
  // The filter is user input and reaches SQL; only the three known values pass through.
  const rawFilter = url.searchParams.get("filter") ?? "all";
  const filter: "open" | "closed" | "all" =
    rawFilter === "open" || rawFilter === "closed" ? rawFilter : "all";
  // Recomputed on every modmail navigation; short TTL collapses the repeated
  // per-ticket lookups. Modmail mutations bust the cache via the SSE webhook.
  const { threads, stats } = await cached(
    cacheKey(["modmail:threads", guildId, filter]),
    CACHE_TTL.short,
    () => ({
      threads: getModmailThreads(guildId, filter),
      stats: getModmailStats(guildId),
    })
  );

  return { threads, stats, filter };
};
