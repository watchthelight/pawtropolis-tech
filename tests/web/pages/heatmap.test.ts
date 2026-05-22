// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/heatmap.test.ts
 * WHAT: Unit tests for dashboard/heatmap/+page.server.ts load().
 * WHY: Pins the sm tier gate, cache-control header, and that the returned
 *      payload comes through the `cached()` wrapper (so cache key changes
 *      are observable in tests).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getHeatmapDataForRange } = vi.hoisted(() => ({
  getHeatmapDataForRange: vi.fn(),
}));

const { cached, cacheKey } = vi.hoisted(() => ({
  cached: vi.fn(async (_k: string, _ttl: number, fn: () => unknown) => fn()),
  cacheKey: vi.fn((parts: unknown[]) => parts.join("|")),
}));

vi.mock("$lib/server/queries/heatmap", () => ({ getHeatmapDataForRange }));
vi.mock("$lib/server/cache", () => ({
  cached,
  cacheKey,
  CACHE_TTL: { medium: 60 },
  CACHE_HEADERS: { default: "public, max-age=60" },
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/heatmap/+page.server.js"
);

function evt(user: unknown) {
  const setHeaders = vi.fn();
  const base = makeEvent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: user as any,
    method: "GET",
    url: "http://localhost/dashboard/heatmap?range=7d",
  });
  (base as unknown as { setHeaders: typeof setHeaders }).setHeaders = setHeaders;
  return { base, setHeaders };
}

beforeEach(() => {
  getHeatmapDataForRange.mockReset();
  cached.mockClear();
  cacheKey.mockClear();
  getHeatmapDataForRange.mockReturnValue({ buckets: [] });
});

describe("dashboard/heatmap load()", () => {
  it("403 for mod tier", async () => {
    const { base } = evt({ id: "u1", tier: "mod" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(base as any)).rejects.toMatchObject({ status: 403 });
  });

  it("sm tier passes; sets cache header; returns cached payload", async () => {
    const { base, setHeaders } = evt({ id: "u1", tier: "sm" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(base as any)) as Record<string, unknown>;
    expect(setHeaders).toHaveBeenCalledWith({ "cache-control": "public, max-age=60" });
    expect(cached).toHaveBeenCalledOnce();
    expect(out.heatmap).toEqual({ buckets: [] });
    expect(out.spec).toBeDefined();
    expect(out.windowLabel).toEqual(expect.any(String));
  });
});
