// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/audit.scans.test.ts
 * WHAT: Unit tests for dashboard/audit/scans/+page.server.ts load().
 * WHY: Pins the dual `getActiveAuditSession(GUILD_ID, "members"|"nsfw")` calls
 *      and the 20-session list cap.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getAuditSessions, getActiveAuditSession } = vi.hoisted(() => ({
  getAuditSessions: vi.fn(),
  getActiveAuditSession: vi.fn(),
}));

vi.mock("$lib/server/queries/auditSystems", () => ({
  getAuditSessions,
  getActiveAuditSession,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/audit/scans/+page.server.js"
);

beforeEach(() => {
  getAuditSessions.mockReset();
  getActiveAuditSession.mockReset();
});

describe("dashboard/audit/scans load()", () => {
  it("calls getActiveAuditSession for both types and getAuditSessions with limit 20", async () => {
    getActiveAuditSession
      .mockReturnValueOnce({ id: "m1" })
      .mockReturnValueOnce(null);
    getAuditSessions.mockReturnValue([{ id: "s1" }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(makeEvent({ method: "GET" }) as any)) as Record<string, unknown>;

    expect(getActiveAuditSession).toHaveBeenNthCalledWith(1, "g-test", "members");
    expect(getActiveAuditSession).toHaveBeenNthCalledWith(2, "g-test", "nsfw");
    expect(getAuditSessions).toHaveBeenCalledWith("g-test", 20);
    expect(out.activeMember).toEqual({ id: "m1" });
    expect(out.activeNsfw).toBeNull();
    expect(out.sessions).toEqual([{ id: "s1" }]);
  });
});
