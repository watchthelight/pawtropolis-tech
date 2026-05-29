/**
 * Public Stats Observatory -- /observatory
 *
 * Zero client JS: csr=false disables hydration, so the page ships as static
 * server-rendered HTML and the root layout's CookieConsent (onMount-gated)
 * never activates. SSR (not prerender) because the rollups change and the
 * build host has no data.db; instead we cache hard at the edge/browser.
 *
 * Public + unauthenticated: no locals.user check. Reads ONLY the precomputed
 * rollup tables for the configured GUILD_ID.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { getObservatoryData } from "$lib/server/queries/observatory";
import { cached, cacheKey, CACHE_TTL } from "$lib/server/cache";
import type { PageServerLoad } from "./$types";

export const csr = false;
export const prerender = false;

export const load: PageServerLoad = async ({ setHeaders }) => {
  // Rollups refresh out of band (~15 min). Cache 5 min, serve stale for a day.
  setHeaders({ "cache-control": "public, max-age=300, stale-while-revalidate=86400" });

  const guildId = process.env.GUILD_ID;
  if (!guildId) return { observatory: null };

  try {
    const observatory = await cached(cacheKey(["observatory", guildId]), CACHE_TTL.long, () =>
      getObservatoryData(guildId)
    );
    return { observatory };
  } catch (err) {
    // No DB present (e.g. preview build) or a read error: render the graceful
    // empty state, but log so a real misconfiguration is not silent.
    console.error("[observatory] failed to load rollups:", err);
    return { observatory: null };
  }
};
