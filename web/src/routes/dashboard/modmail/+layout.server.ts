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
  const filter = (url.searchParams.get("filter") ?? "all") as "open" | "closed" | "all";
  // Recomputed on every modmail navigation; short TTL collapses the repeated
  // per-ticket lookups. Modmail mutations bust the cache via the SSE webhook.
  const threads = await cached(
    cacheKey(["modmail:threads", guildId, filter]),
    CACHE_TTL.short,
    () => getModmailThreads(guildId, filter)
  );
  const stats = getModmailStats(guildId);

  return { threads, stats, filter };
};
