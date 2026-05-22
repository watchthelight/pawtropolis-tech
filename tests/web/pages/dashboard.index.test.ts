// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/dashboard.index.test.ts
 * WHAT: Unit tests for dashboard/+page.server.ts load() (home).
 * WHY: Pins the artist-without-staff -> /dashboard/art 302 redirect, the
 *      `includeModTier` propagation, and the GUILD_ID env requirement.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { getHomeMetrics } = vi.hoisted(() => ({ getHomeMetrics: vi.fn() }));

vi.mock("$lib/server/queries/home", () => ({ getHomeMetrics }));

const ARTIST_ROLE = "896070888749940770";

beforeEach(() => {
  process.env.GUILD_ID = "g-test";
  getHomeMetrics.mockReset();
  getHomeMetrics.mockReturnValue({ apps: 0 });
});

const { load } = await import(
  "../../../web/src/routes/dashboard/+page.server.js"
);

describe("dashboard/ load()", () => {
  it("throws when GUILD_ID env unset", async () => {
    const prev = process.env.GUILD_ID;
    delete process.env.GUILD_ID;
    try {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        load(makeEvent({ user: { id: "u1", tier: "mod" }, method: "GET" }) as any),
      ).rejects.toThrow(/GUILD_ID/);
    } finally {
      process.env.GUILD_ID = prev;
    }
  });

  it("artist without staff tier gets 302 redirect to /dashboard/art", async () => {
    await expect(
      load(
        makeEvent({
          user: { id: "u1", tier: "none", roles: [ARTIST_ROLE] },
          method: "GET",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      ),
    ).rejects.toMatchObject({ status: 302, location: "/dashboard/art" });
  });

  it("artist who is also staff (gk+) does NOT redirect; sees metrics", async () => {
    const out = (await load(
      makeEvent({
        user: { id: "u1", tier: "gk", roles: [ARTIST_ROLE] },
        method: "GET",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    )) as Record<string, unknown>;
    expect(out.metrics).toBeDefined();
    expect(getHomeMetrics).toHaveBeenCalledWith("u1", "g-test", false);
  });

  it("includeModTier = true at mod tier and above", async () => {
    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEvent({ user: { id: "u1", tier: "mod" }, method: "GET" }) as any,
    );
    expect(getHomeMetrics).toHaveBeenLastCalledWith("u1", "g-test", true);
  });
});
