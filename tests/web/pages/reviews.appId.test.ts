// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/reviews.appId.test.ts
 * WHAT: Unit tests for dashboard/reviews/[appId]/+page.server.ts load().
 * WHY: First +page.server.ts under test (slice 10 of #00012). Pins the 404
 *      path, the four query fan-out calls, the admin-unclaim toggle, and the
 *      nullable sessionUserId. GUILD_ID is captured at module top so env must
 *      be set before dynamic import (same pattern as internal.events.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getApplicationDetail, getCachedProfile, getUserPriorDecisions, getVoteOutInfo } =
  vi.hoisted(() => ({
    getApplicationDetail: vi.fn(),
    getCachedProfile: vi.fn(),
    getUserPriorDecisions: vi.fn(),
    getVoteOutInfo: vi.fn(),
  }));

const { getModmailForApplication } = vi.hoisted(() => ({
  getModmailForApplication: vi.fn(),
}));

vi.mock("$lib/server/queries/reviews", () => ({
  getApplicationDetail,
  getCachedProfile,
  getUserPriorDecisions,
  getVoteOutInfo,
}));

vi.mock("$lib/server/queries/modmail", () => ({
  getModmailForApplication,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/reviews/[appId]/+page.server.js"
);

const appDetail = {
  id: "app-1",
  userId: "u-applicant",
  status: "pending",
  submittedAt: 1700000000,
};

function evt(
  overrides: Partial<Parameters<typeof makeEvent>[0]> = {},
) {
  return makeEvent({
    user: { id: "u-staff", tier: "gk" },
    params: { appId: "app-1" },
    method: "GET",
    ...overrides,
  });
}

beforeEach(() => {
  getApplicationDetail.mockReset();
  getCachedProfile.mockReset();
  getUserPriorDecisions.mockReset();
  getVoteOutInfo.mockReset();
  getModmailForApplication.mockReset();
});

describe("dashboard/reviews/[appId] load()", () => {
  it("404 when getApplicationDetail returns null", async () => {
    getApplicationDetail.mockReturnValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt() as any)).rejects.toMatchObject({ status: 404 });
    expect(getApplicationDetail).toHaveBeenCalledWith("app-1", "g-test");
    expect(getModmailForApplication).not.toHaveBeenCalled();
  });

  it("happy path fans out four queries with (userId|appId, guildId)", async () => {
    getApplicationDetail.mockReturnValue(appDetail);
    getModmailForApplication.mockReturnValue([{ id: "mm1" }]);
    getCachedProfile.mockReturnValue({ username: "alice" });
    getUserPriorDecisions.mockReturnValue([]);
    getVoteOutInfo.mockReturnValue({ active: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt() as any)) as Record<string, unknown>;

    expect(getModmailForApplication).toHaveBeenCalledWith("u-applicant", "g-test");
    expect(getCachedProfile).toHaveBeenCalledWith("u-applicant", "g-test");
    expect(getUserPriorDecisions).toHaveBeenCalledWith("u-applicant", "g-test", "app-1");
    expect(getVoteOutInfo).toHaveBeenCalledWith("app-1", "g-test");

    expect(out.app).toBe(appDetail);
    expect(out.modmail).toEqual([{ id: "mm1" }]);
    expect(out.cachedProfile).toEqual({ username: "alice" });
    expect(out.priorDecisions).toEqual([]);
    expect(out.voteOutInfo).toEqual({ active: false });
  });

  it("canAdminUnclaim true for admin tier", async () => {
    getApplicationDetail.mockReturnValue(appDetail);
    getModmailForApplication.mockReturnValue([]);
    getCachedProfile.mockReturnValue(null);
    getUserPriorDecisions.mockReturnValue([]);
    getVoteOutInfo.mockReturnValue({ active: false });

    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ user: { id: "u-staff", tier: "admin" } }) as any,
    )) as Record<string, unknown>;

    expect(out.canAdminUnclaim).toBe(true);
    expect(out.sessionUserId).toBe("u-staff");
  });

  it("canAdminUnclaim false for mod tier (below admin)", async () => {
    getApplicationDetail.mockReturnValue(appDetail);
    getModmailForApplication.mockReturnValue([]);
    getCachedProfile.mockReturnValue(null);
    getUserPriorDecisions.mockReturnValue([]);
    getVoteOutInfo.mockReturnValue({ active: false });

    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ user: { id: "u-staff", tier: "mod" } }) as any,
    )) as Record<string, unknown>;

    expect(out.canAdminUnclaim).toBe(false);
  });

  it("canAdminUnclaim true for higher-than-admin tiers (sa, cdl, cm, owner)", async () => {
    getApplicationDetail.mockReturnValue(appDetail);
    getModmailForApplication.mockReturnValue([]);
    getCachedProfile.mockReturnValue(null);
    getUserPriorDecisions.mockReturnValue([]);
    getVoteOutInfo.mockReturnValue({ active: false });

    for (const tier of ["sa", "cdl", "cm", "owner"] as const) {
      const out = (await load(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evt({ user: { id: "u-staff", tier } }) as any,
      )) as Record<string, unknown>;
      expect(out.canAdminUnclaim).toBe(true);
    }
  });

  it("sessionUserId null when locals.user is absent", async () => {
    getApplicationDetail.mockReturnValue(appDetail);
    getModmailForApplication.mockReturnValue([]);
    getCachedProfile.mockReturnValue(null);
    getUserPriorDecisions.mockReturnValue([]);
    getVoteOutInfo.mockReturnValue({ active: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt({ user: null }) as any)) as Record<string, unknown>;

    expect(out.sessionUserId).toBeNull();
    expect(out.canAdminUnclaim).toBe(false);
  });
});
