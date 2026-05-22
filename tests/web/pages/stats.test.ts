// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/stats.test.ts
 * WHAT: Unit tests for dashboard/stats/+page.server.ts load().
 * WHY: Pins gk gate, cache-control header, the parallel personal+team
 *      cached() pair, and that `trend` is computed via a third cached() call
 *      that takes `personalData.personal` as input (locking the dependency).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const queryMocks = vi.hoisted(() => ({
  getPersonalStats: vi.fn(),
  getPersonalStatsTrend: vi.fn(),
  getActivityTimeline: vi.fn(),
  getResponseTrend: vi.fn(),
  getTeamStats: vi.fn(),
  getModBreakdowns: vi.fn(),
  getDecisionPercentiles: vi.fn(),
  getInviteSourceBreakdown: vi.fn(),
  getApplicationFunnel: vi.fn(),
}));

const { cached, cacheKey } = vi.hoisted(() => ({
  cached: vi.fn(async (_k: string, _ttl: number, fn: () => unknown) => fn()),
  cacheKey: vi.fn((parts: unknown[]) => parts.join("|")),
}));

vi.mock("$lib/server/queries/stats", () => queryMocks);
vi.mock("$lib/server/cache", () => ({
  cached,
  cacheKey,
  CACHE_TTL: { medium: 60 },
  CACHE_HEADERS: { default: "public, max-age=60" },
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/stats/+page.server.js"
);

function evt(user: unknown) {
  const setHeaders = vi.fn();
  const base = makeEvent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: user as any,
    method: "GET",
    url: "http://localhost/dashboard/stats",
  });
  (base as unknown as { setHeaders: typeof setHeaders }).setHeaders = setHeaders;
  return { base, setHeaders };
}

beforeEach(() => {
  for (const fn of Object.values(queryMocks)) {
    fn.mockReset();
    fn.mockReturnValue({});
  }
  queryMocks.getPersonalStats.mockReturnValue({ posts: 10 });
  queryMocks.getPersonalStatsTrend.mockReturnValue({ delta: 5 });
  cached.mockClear();
});

describe("dashboard/stats load()", () => {
  it("403 for viewer (gk required)", async () => {
    const { base } = evt({ id: "u1", tier: "viewer" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(base as any)).rejects.toMatchObject({ status: 403 });
  });

  it("gk passes; setHeaders cache header; cached called 3x; trend uses personal stats", async () => {
    const { base, setHeaders } = evt({ id: "u1", tier: "gk" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(base as any)) as Record<string, unknown>;

    expect(setHeaders).toHaveBeenCalledWith({
      "cache-control": "public, max-age=60",
    });
    expect(cached).toHaveBeenCalledTimes(3);
    expect(queryMocks.getPersonalStatsTrend).toHaveBeenCalledWith(
      "u1",
      "g-test",
      expect.anything(),
      { posts: 10 },
    );
    expect(out.userId).toBe("u1");
    expect(out.trend).toEqual({ delta: 5 });
  });
});
