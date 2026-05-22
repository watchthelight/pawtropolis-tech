// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/audit.security.test.ts
 * WHAT: Unit tests for dashboard/audit/security/+page.server.ts load().
 * WHY: SA gate (parent userTier < sa = 403), five-query fan-out, and the
 *      latest-snapshot lookup with optional full-issues join. `parent()` is
 *      part of the page load signature; tests must stub it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const {
  getLatestSecuritySnapshot,
  getSecuritySnapshots,
  getSecurityIssueTrends,
  getAcknowledgedIssuesList,
  getSecuritySnapshotFull,
} = vi.hoisted(() => ({
  getLatestSecuritySnapshot: vi.fn(),
  getSecuritySnapshots: vi.fn(),
  getSecurityIssueTrends: vi.fn(),
  getAcknowledgedIssuesList: vi.fn(),
  getSecuritySnapshotFull: vi.fn(),
}));

vi.mock("$lib/server/queries/auditSystems", () => ({
  getLatestSecuritySnapshot,
  getSecuritySnapshots,
  getSecurityIssueTrends,
  getAcknowledgedIssuesList,
  getSecuritySnapshotFull,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/audit/security/+page.server.js"
);

function evt(userTier: string) {
  const base = makeEvent({ method: "GET" });
  (base as unknown as { parent: () => Promise<unknown> }).parent = () =>
    Promise.resolve({ userTier });
  return base;
}

beforeEach(() => {
  getLatestSecuritySnapshot.mockReset();
  getSecuritySnapshots.mockReset();
  getSecurityIssueTrends.mockReset();
  getAcknowledgedIssuesList.mockReset();
  getSecuritySnapshotFull.mockReset();
});

describe("dashboard/audit/security load()", () => {
  it("403 when parent userTier < sa (admin)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt("admin") as any)).rejects.toMatchObject({ status: 403 });
  });

  it("happy path: sa tier, no latest snapshot -> issues = []", async () => {
    getLatestSecuritySnapshot.mockReturnValue(null);
    getSecuritySnapshots.mockReturnValue([{ id: 1 }]);
    getSecurityIssueTrends.mockReturnValue([{ day: "d1" }]);
    getAcknowledgedIssuesList.mockReturnValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt("sa") as any)) as Record<string, unknown>;

    expect(out.latest).toBeNull();
    expect(out.snapshots).toEqual([{ id: 1 }]);
    expect(out.trends).toEqual([{ day: "d1" }]);
    expect(out.acknowledged).toEqual([]);
    expect(out.issues).toEqual([]);
    expect(getSecuritySnapshotFull).not.toHaveBeenCalled();
    expect(getSecuritySnapshots).toHaveBeenCalledWith("g-test", 20);
    expect(getSecurityIssueTrends).toHaveBeenCalledWith("g-test", 30);
  });

  it("happy path: latest snapshot loads full issuesSnapshot", async () => {
    getLatestSecuritySnapshot.mockReturnValue({ id: 7 });
    getSecuritySnapshots.mockReturnValue([]);
    getSecurityIssueTrends.mockReturnValue([]);
    getAcknowledgedIssuesList.mockReturnValue([]);
    getSecuritySnapshotFull.mockReturnValue({
      issuesSnapshot: [{ rule: "X" }],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt("sa") as any)) as Record<string, unknown>;

    expect(out.issues).toEqual([{ rule: "X" }]);
    expect(getSecuritySnapshotFull).toHaveBeenCalledWith("g-test", 7);
  });

  it("latest present but full snapshot returns null -> issues = []", async () => {
    getLatestSecuritySnapshot.mockReturnValue({ id: 7 });
    getSecuritySnapshots.mockReturnValue([]);
    getSecurityIssueTrends.mockReturnValue([]);
    getAcknowledgedIssuesList.mockReturnValue([]);
    getSecuritySnapshotFull.mockReturnValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt("sa") as any)) as Record<string, unknown>;
    expect(out.issues).toEqual([]);
  });

  it("owner tier passes the gate", async () => {
    getLatestSecuritySnapshot.mockReturnValue(null);
    getSecuritySnapshots.mockReturnValue([]);
    getSecurityIssueTrends.mockReturnValue([]);
    getAcknowledgedIssuesList.mockReturnValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt("owner") as any)).resolves.toBeDefined();
  });
});
