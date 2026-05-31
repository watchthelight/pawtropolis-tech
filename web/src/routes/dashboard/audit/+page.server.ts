import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import { getAuditLog, getActionTypes, type AuditFilters } from "$lib/server/queries/audit";
import { cached, cacheKey, CACHE_TTL, CACHE_HEADERS } from "$lib/server/cache";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  setHeaders({ "cache-control": CACHE_HEADERS.default });
  if (!locals.user || !hasMinTier(locals.user.tier, "admin")) {
    error(403, "You don't have permission to view this page.");
  }
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");
  const guildId = process.env.GUILD_ID;

  const action = url.searchParams.get("action") || undefined;
  const search = (url.searchParams.get("q") || "").trim().slice(0, 100) || undefined;
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : undefined;

  const nowS = Math.floor(Date.now() / 1000);
  const defaultFromS = nowS - 7 * 86400;
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const fromS = fromParam
    ? Math.floor(new Date(fromParam).getTime() / 1000) || defaultFromS
    : defaultFromS;
  const toS = toParam ? Math.floor(new Date(toParam).getTime() / 1000) || undefined : undefined;

  const filters: AuditFilters = {
    action,
    search,
    fromS,
    toS,
    cursor: Number.isFinite(cursor) ? cursor : undefined,
  };

  const key = cacheKey([
    "audit:log",
    guildId,
    action ?? "",
    search ?? "",
    fromS,
    toS ?? "",
    cursor ?? "",
  ]);

  // Work is bounded at the SQL layer (mandatory date window, keyset LIMIT,
  // FTS-indexed search, capped user_cache lookup). better-sqlite3 is synchronous,
  // so a Promise.race timeout could never interrupt it — don't pretend it guards.
  const result = await cached(key, CACHE_TTL.medium, () => ({
    ...getAuditLog(guildId, filters),
    actionTypes: getActionTypes(guildId),
  }));
  return {
    ...result,
    filters: {
      action: action ?? "",
      search: search ?? "",
      from: fromParam ?? "",
      to: toParam ?? "",
    },
  };
};
