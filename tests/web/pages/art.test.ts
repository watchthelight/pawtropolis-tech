// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/art.test.ts
 * WHAT: Unit tests for dashboard/art/+page.server.ts load().
 * WHY: Pins 401 (no user), 403 (neither artist nor sm-tier staff), the
 *      `myJobs` self-filter on `activeJobs`, and the dual leaderboard scope
 *      (monthly + alltime).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const ARTIST_ROLE = "896070888749940770";

const { getArtistQueue, getActiveJobs, getJobHistory, getLeaderboard } = vi.hoisted(() => ({
  getArtistQueue: vi.fn(),
  getActiveJobs: vi.fn(),
  getJobHistory: vi.fn(),
  getLeaderboard: vi.fn(),
}));

vi.mock("$lib/server/queries/art", () => ({
  getArtistQueue,
  getActiveJobs,
  getJobHistory,
  getLeaderboard,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/art/+page.server.js"
);

beforeEach(() => {
  getArtistQueue.mockReset();
  getActiveJobs.mockReset();
  getJobHistory.mockReset();
  getLeaderboard.mockReset();
  getArtistQueue.mockReturnValue([]);
  getActiveJobs.mockReturnValue([]);
  getJobHistory.mockReturnValue([]);
  getLeaderboard.mockReturnValue([]);
});

describe("dashboard/art load()", () => {
  it("401 when no user", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(makeEvent({ user: null, method: "GET" }) as any),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when neither artist nor sm-tier staff", async () => {
    await expect(
      load(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeEvent({ user: { id: "u1", tier: "mod", roles: [] }, method: "GET" }) as any,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("artist alone (no staff) passes the gate", async () => {
    const out = (await load(
      makeEvent({
        user: { id: "u1", tier: "none", roles: [ARTIST_ROLE] },
        method: "GET",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    )) as Record<string, unknown>;
    expect(out.isArtist).toBe(true);
    expect(out.isStaff).toBe(false);
  });

  it("staff (sm+) without artist role passes; isArtist=false", async () => {
    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEvent({ user: { id: "u1", tier: "sm", roles: [] }, method: "GET" }) as any,
    )) as Record<string, unknown>;
    expect(out.isArtist).toBe(false);
    expect(out.isStaff).toBe(true);
  });

  it("myJobs filters activeJobs by artistId === user.id", async () => {
    getActiveJobs.mockReturnValue([
      { id: "j1", artistId: "u1" },
      { id: "j2", artistId: "other" },
      { id: "j3", artistId: "u1" },
    ]);
    const out = (await load(
      makeEvent({
        user: { id: "u1", tier: "sm", roles: [] },
        method: "GET",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    )) as Record<string, unknown>;
    expect(out.myJobs).toEqual([
      { id: "j1", artistId: "u1" },
      { id: "j3", artistId: "u1" },
    ]);
    expect(getLeaderboard).toHaveBeenCalledWith("g-test", "monthly", 10);
    expect(getLeaderboard).toHaveBeenCalledWith("g-test", "alltime", 10);
    expect(getJobHistory).toHaveBeenCalledWith("g-test", 1, 20);
  });
});
