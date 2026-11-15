// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/quality.test.ts
 * WHAT: Tests for dashboard/quality/+page.server.ts load().
 * WHY: The page shows scores of members' messages with author names, so the
 *      moderator gate has to hold. A host without a score file must get an
 *      answer and not an error, and the passes over the scores must run
 *      inside the cache.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const queries = vi.hoisted(() => ({
  getAllTimeMeans: vi.fn(),
  getAuthorBoards: vi.fn(),
  getRecentTrend: vi.fn(),
  getScoreStatus: vi.fn(),
  getWeeklyMeasures: vi.fn(),
  getWindowSummary: vi.fn(),
}));

const { cached, cacheKey } = vi.hoisted(() => ({
  cached: vi.fn(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  cacheKey: vi.fn((parts: unknown[]) => parts.join("|")),
}));

vi.mock("$lib/server/queries/quality", () => queries);
vi.mock("$lib/server/cache", () => ({
  cached,
  cacheKey,
  CACHE_TTL: { veryLong: 1800 },
  CACHE_HEADERS: { default: "private, max-age=60" },
}));

const { load } = await import("../../../web/src/routes/dashboard/quality/+page.server.js");

const STATUS = { total: 12, pending: 0, oldestS: 100, newestS: 200, lastRunS: 300 };

function evt(user: unknown, query = "") {
  const setHeaders = vi.fn();
  const base = makeEvent({
    user: user as never,
    method: "GET",
    url: `http://localhost/dashboard/quality${query}`,
  });
  (base as unknown as { setHeaders: typeof setHeaders }).setHeaders = setHeaders;
  return { base, setHeaders };
}

async function run(user: unknown, query = "") {
  const { base, setHeaders } = evt(user, query);
  const out = (await load(base as never)) as Record<string, unknown>;
  return { out, setHeaders };
}

beforeEach(() => {
  for (const fn of Object.values(queries)) fn.mockReset();
  queries.getScoreStatus.mockReturnValue(STATUS);
  queries.getWindowSummary.mockReturnValue("summary");
  queries.getAuthorBoards.mockReturnValue("boards");
  queries.getWeeklyMeasures.mockReturnValue("measures");
  queries.getRecentTrend.mockReturnValue("trend");
  queries.getAllTimeMeans.mockReturnValue("all time");
  cached.mockClear();
});

describe("dashboard/quality load()", () => {
  it("refuses a junior moderator and reads nothing", async () => {
    const { base, setHeaders } = evt({ id: "u1", tier: "jm" });
    await expect(load(base as never)).rejects.toMatchObject({ status: 403 });
    expect(queries.getScoreStatus).not.toHaveBeenCalled();
    expect(cached).not.toHaveBeenCalled();
    // No cache header on the refusal: a browser must not keep it.
    expect(setHeaders).not.toHaveBeenCalled();
  });

  it("refuses a request without a user", async () => {
    const { base } = evt(null);
    await expect(load(base as never)).rejects.toMatchObject({ status: 403 });
  });

  it("answers without scores on a host that has no score file", async () => {
    queries.getScoreStatus.mockReturnValue(null);
    const { out, setHeaders } = await run({ id: "u1", tier: "mod" });

    expect(out.status).toBeNull();
    expect(out.scores).toBeNull();
    expect(out.windowLabel).toBe("Last 30 days");
    // Nothing is kept, so the page fills in as soon as the job has written the file.
    expect(cached).not.toHaveBeenCalled();
    expect(queries.getWindowSummary).not.toHaveBeenCalled();
    expect(setHeaders).toHaveBeenCalledWith({ "cache-control": "private, max-age=60" });
  });

  it("reads the window once, inside the cache, for half an hour", async () => {
    const { out } = await run({ id: "u1", tier: "mod" });

    expect(out.status).toEqual(STATUS);
    expect(out.scores).toEqual({
      summary: "summary",
      boards: "boards",
      measures: "measures",
      trend: "trend",
      allTime: "all time",
    });
    expect(cached).toHaveBeenCalledTimes(1);
    const [key, ttl] = cached.mock.calls[0]!;
    expect(key).toContain("quality:window");
    expect(key).toContain("g-test");
    expect(ttl).toBe(1800);
  });

  it("takes the last 30 days when the address names no window", async () => {
    const { out } = await run({ id: "u1", tier: "owner" });

    expect(out.spec).toEqual({ kind: "preset", preset: "30d" });
    const range = queries.getWindowSummary.mock.calls[0]![0] as { startS: number; endS: number };
    expect(range.endS - range.startS).toBe(30 * 86400);
    expect(queries.getAuthorBoards).toHaveBeenCalledWith("g-test", range);
    expect(queries.getWeeklyMeasures).toHaveBeenCalledWith(range);
    expect(queries.getRecentTrend).toHaveBeenCalledWith(range.endS);
  });

  it("takes the window the address names", async () => {
    const { out } = await run({ id: "u1", tier: "mod" }, "?window=all");

    expect(out.windowLabel).toBe("All time");
    const range = queries.getWindowSummary.mock.calls[0]![0] as { startS: number };
    expect(range.startS).toBe(0);
  });

  it("keeps a window of its own for each range", async () => {
    await run({ id: "u1", tier: "mod" }, "?window=7d");
    await run({ id: "u1", tier: "mod" }, "?window=90d");

    expect(cached.mock.calls[0]![0]).not.toBe(cached.mock.calls[1]![0]);
  });
});
