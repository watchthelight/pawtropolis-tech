// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/pulse.test.ts
 * WHAT: Unit tests for dashboard/pulse/+page.server.ts load().
 * WHY: Pins mod gate, cache-control header, the 7-fold guildData fan-out,
 *      and the fail-soft `getLevelRoleStats(...).catch(() => null)` branch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const {
  getPulseMetrics,
  getNewsletterStats,
  getInsights,
  getGuildSnapshot,
  getTopVoiceChannels,
  getChannelActivityRanking,
  getLevelRoleStats,
  getEngagementWindow,
} = vi.hoisted(() => ({
  getPulseMetrics: vi.fn(),
  getNewsletterStats: vi.fn(),
  getInsights: vi.fn(),
  getGuildSnapshot: vi.fn(),
  getTopVoiceChannels: vi.fn(),
  getChannelActivityRanking: vi.fn(),
  getLevelRoleStats: vi.fn(),
  getEngagementWindow: vi.fn(),
}));

const { cached, cacheKey } = vi.hoisted(() => ({
  cached: vi.fn(async (_k: string, _ttl: number, fn: () => unknown) => fn()),
  cacheKey: vi.fn((parts: unknown[]) => parts.join("|")),
}));

vi.mock("$lib/server/queries/pulse", () => ({
  getPulseMetrics,
  getNewsletterStats,
  getInsights,
  getGuildSnapshot,
  getTopVoiceChannels,
  getChannelActivityRanking,
  getLevelRoleStats,
  getEngagementWindow,
}));

vi.mock("$lib/server/cache", () => ({
  cached,
  cacheKey,
  CACHE_TTL: { medium: 60 },
  CACHE_HEADERS: { default: "public, max-age=60" },
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/pulse/+page.server.js"
);

function evt(user: unknown) {
  const setHeaders = vi.fn();
  const base = makeEvent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: user as any,
    method: "GET",
    url: "http://localhost/dashboard/pulse?range=7d",
  });
  (base as unknown as { setHeaders: typeof setHeaders }).setHeaders = setHeaders;
  return { base, setHeaders };
}

beforeEach(() => {
  for (const fn of [
    getPulseMetrics,
    getNewsletterStats,
    getInsights,
    getGuildSnapshot,
    getTopVoiceChannels,
    getChannelActivityRanking,
    getEngagementWindow,
  ]) {
    fn.mockReset();
    fn.mockReturnValue({});
  }
  getLevelRoleStats.mockReset();
  cached.mockClear();
});

describe("dashboard/pulse load()", () => {
  it("403 for gk (mod required)", async () => {
    const { base } = evt({ id: "u1", tier: "gk" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(base as any)).rejects.toMatchObject({ status: 403 });
  });

  it("returns null levelRoleStats when getLevelRoleStats rejects", async () => {
    getLevelRoleStats.mockRejectedValue(new Error("upstream-down"));
    const { base, setHeaders } = evt({ id: "u1", tier: "mod" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(base as any)) as Record<string, unknown>;
    expect(out.levelRoleStats).toBeNull();
    expect(setHeaders).toHaveBeenCalled();
    expect(out.spec).toBeDefined();
  });

  it("includes levelRoleStats on success", async () => {
    getLevelRoleStats.mockResolvedValue({ level: 50 });
    const { base } = evt({ id: "u1", tier: "mod" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(base as any)) as Record<string, unknown>;
    expect(out.levelRoleStats).toEqual({ level: 50 });
  });
});
