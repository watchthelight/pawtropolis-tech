// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/system.test.ts
 * WHAT: Unit tests for dashboard/system/+page.server.ts load().
 * WHY: Pins owner gate, the alerts + (cached) health pair, and the fail-soft
 *      health = null branch when callBotApi throws or returns success=false.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { getRecentHealthAlerts } = vi.hoisted(() => ({
  getRecentHealthAlerts: vi.fn(),
}));

const { callBotApi } = vi.hoisted(() => ({ callBotApi: vi.fn() }));

const { cached, cacheKey } = vi.hoisted(() => ({
  cached: vi.fn(async (_k: string, _ttl: number, fn: () => unknown) => fn()),
  cacheKey: vi.fn((parts: unknown[]) => parts.join("|")),
}));

vi.mock("$lib/server/queries/system", () => ({ getRecentHealthAlerts }));
vi.mock("$lib/server/botApi", () => ({ callBotApi }));
vi.mock("$lib/server/cache", () => ({
  cached,
  cacheKey,
  CACHE_TTL: { medium: 60 },
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/system/+page.server.js"
);

function evt(user: unknown) {
  return makeEvent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: user as any,
    method: "GET",
  });
}

beforeEach(() => {
  getRecentHealthAlerts.mockReset();
  callBotApi.mockReset();
  cached.mockClear();
  getRecentHealthAlerts.mockReturnValue([{ id: "a1" }]);
});

describe("dashboard/system load()", () => {
  it("403 for admin (owner required)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt({ id: "u1", tier: "admin" }) as any)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("happy path returns alerts + health when bot succeeds", async () => {
    callBotApi.mockResolvedValue({ success: true, data: { uptime: 10 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt({ id: "u1", tier: "owner" }) as any)) as Record<string, unknown>;
    expect(out.alerts).toEqual([{ id: "a1" }]);
    expect(out.health).toEqual({ uptime: 10 });
    expect(callBotApi).toHaveBeenCalledWith(
      "/api/dashboard/health",
      { userId: "u1", tier: "owner" },
      120_000,
    );
  });

  it("health = null when callBotApi rejects", async () => {
    callBotApi.mockRejectedValue(new Error("timeout"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt({ id: "u1", tier: "owner" }) as any)) as Record<string, unknown>;
    expect(out.health).toBeNull();
    expect(out.alerts).toEqual([{ id: "a1" }]);
  });

  it("health = null when success=false", async () => {
    callBotApi.mockResolvedValue({ success: false, error: "bot-down" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt({ id: "u1", tier: "owner" }) as any)) as Record<string, unknown>;
    expect(out.health).toBeNull();
  });
});
