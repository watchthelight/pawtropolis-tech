// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/backfill.test.ts
 * WHAT: Unit tests for dashboard/backfill/+page.server.ts load().
 * WHY: Pins the owner-only gate (admin tier alone is denied) and the
 *      three-query initial payload shape.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { getBackfillStats, getBackfillChannels, getArchiveCounts } = vi.hoisted(() => ({
  getBackfillStats: vi.fn(),
  getBackfillChannels: vi.fn(),
  getArchiveCounts: vi.fn(),
}));

vi.mock("$lib/server/queries/backfill", () => ({
  getBackfillStats,
  getBackfillChannels,
  getArchiveCounts,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/backfill/+page.server.js"
);

beforeEach(() => {
  getBackfillStats.mockReset();
  getBackfillChannels.mockReset();
  getArchiveCounts.mockReset();
  getBackfillStats.mockReturnValue({ s: 1 });
  getBackfillChannels.mockReturnValue([{ c: 1 }]);
  getArchiveCounts.mockReturnValue({ a: 1 });
});

describe("dashboard/backfill load()", () => {
  it("403 for admin tier (owner required)", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(makeEvent({ user: { id: "u1", tier: "admin" }, method: "GET" }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 when no user", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(makeEvent({ user: null, method: "GET" }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("owner sees all three initial datasets", async () => {
    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEvent({ user: { id: "u1", tier: "owner" }, method: "GET" }) as any,
    )) as Record<string, unknown>;
    expect(out.initialStats).toEqual({ s: 1 });
    expect(out.initialChannels).toEqual([{ c: 1 }]);
    expect(out.initialCounts).toEqual({ a: 1 });
  });
});
