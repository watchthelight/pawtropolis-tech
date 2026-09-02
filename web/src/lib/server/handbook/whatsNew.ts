/**
 * Pawtropolis Tech — web/src/lib/server/handbook/whatsNew.ts
 * WHAT: Collects handbook sections currently flagged as new, for the banner.
 * WHY: Members do not re-read the handbook, so a section added last week goes unnoticed.
 *      A section carries `<!-- new: YYYY-MM-DD -->` under its heading and shows up here
 *      for a week, then drops off on its own with no cleanup commit.
 */

import { DOC_REGISTRY, getRawTokens, preloadAll } from "./loader";
import { decorate, resetSlugCounter } from "./decorator";
import { meetsTier, type HandbookTier } from "./permissionResolver";
import { isWithinNewWindow, type WhatsNewEntry } from "../../handbook-shared";
import type { DashboardTier } from "../roles";

export type { WhatsNewEntry };

/**
 * Every flagged section a viewer is allowed to see, newest first.
 *
 * Not cached: the result depends on the current date, and a cache would keep serving a
 * stale set after a marker expires. The walk is over already-tokenised docs, the same
 * work `getSearchIndex` does, so it is cheap enough to redo per request.
 */
// Keyed by viewer tier and UTC day: the result only changes when a marker crosses the
// window boundary (a date change) or the docs are rebuilt (a deploy), so the per-request
// walk over every handbook document on /dashboard and /handbook is remembered per day.
const whatsNewCache = new Map<string, WhatsNewEntry[]>();

export function getWhatsNew(viewer: { tier: DashboardTier | null }): WhatsNewEntry[] {
  preloadAll();

  const isLoggedOut = viewer.tier === null;
  const viewerTier: HandbookTier = viewer.tier === null ? "public" : viewer.tier;

  const day = new Date().toISOString().slice(0, 10);
  const cacheKey = `${day}|${viewerTier}|${isLoggedOut ? "out" : "in"}`;
  const hit = whatsNewCache.get(cacheKey);
  if (hit) return hit;
  if (whatsNewCache.size > 0 && ![...whatsNewCache.keys()][0]!.startsWith(day)) {
    whatsNewCache.clear();
  }

  const entries: WhatsNewEntry[] = [];

  for (const meta of DOC_REGISTRY) {
    resetSlugCounter();
    // Decorate as owner so locked sections are still walked; visibility is applied below
    // from the section's own tier, matching how getSearchIndex does it.
    const decorated = decorate(getRawTokens(meta.slug), meta, "owner", false);

    for (const entry of decorated.tocEntries) {
      if (!isWithinNewWindow(entry.newSince)) continue;
      if (isLoggedOut && entry.tier !== "public") continue;
      if (!meetsTier(viewerTier, entry.tier)) continue;

      entries.push({
        docSlug: meta.slug,
        docTitle: meta.title,
        headingSlug: entry.slug,
        headingText: entry.text,
        since: entry.newSince!,
        tier: entry.tier,
        href: `/handbook/${meta.slug}#${entry.slug}`,
      });
    }
  }

  entries.sort((a, b) => (a.since === b.since ? 0 : a.since < b.since ? 1 : -1));
  whatsNewCache.set(cacheKey, entries);
  return entries;
}

/** Newest marker date in a set, used as the localStorage dismissal key. */
export function newestSince(entries: WhatsNewEntry[]): string | null {
  return entries.length ? entries[0]!.since : null;
}
