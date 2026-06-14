/**
 * Pawtropolis Tech — tests/web/eventCacheBust.test.ts
 * WHAT: Unit tests for the SSE-event to cache-prefix routing table.
 * WHY: A review mutation must bust the review queue cache, not only pulse/stats,
 *      or the queue list stays stale until the TTL expires after claim/unclaim.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";

const { cachePrefixesForEvent } = await import(
  "../../web/src/lib/server/events/cacheBust.js"
);

const GUILD = "111222333";

describe("cachePrefixesForEvent", () => {
  it("REGRESSION: review events bust the reviews:queue cache", () => {
    expect(cachePrefixesForEvent("review:claimed", GUILD)).toContain("reviews:queue");
    expect(cachePrefixesForEvent("review:unclaimed", GUILD)).toContain("reviews:queue");
  });

  it("modmail and flag events also bust the reviews:queue cache", () => {
    expect(cachePrefixesForEvent("modmail:thread_opened", GUILD)).toContain("reviews:queue");
    expect(cachePrefixesForEvent("flag:created", GUILD)).toContain("reviews:queue");
  });

  it("review events still bust pulse and stats prefixes", () => {
    const prefixes = cachePrefixesForEvent("review:claimed", GUILD);
    expect(prefixes).toContain(`pulse:guild:${GUILD}`);
    expect(prefixes).toContain(`pulse:snapshot:${GUILD}`);
    expect(prefixes).toContain("stats:");
  });

  it("stats events bust only the stats prefix, not reviews:queue", () => {
    const prefixes = cachePrefixesForEvent("stats:updated", GUILD);
    expect(prefixes).toEqual(["stats:"]);
  });

  it("unrelated events bust nothing", () => {
    expect(cachePrefixesForEvent("ticket:opened", GUILD)).toEqual([]);
    expect(cachePrefixesForEvent("config:updated", GUILD)).toEqual([]);
  });
});
