// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/audit.security.id.test.ts
 * WHAT: Unit tests for dashboard/audit/security/[id]/+page.server.ts load().
 * WHY: Three-way error gate: 403 (sa), 400 (NaN id), 404 (missing snapshot).
 *      Each must be locked separately because they fire in order.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getSecuritySnapshotFull } = vi.hoisted(() => ({
  getSecuritySnapshotFull: vi.fn(),
}));

vi.mock("$lib/server/queries/auditSystems", () => ({
  getSecuritySnapshotFull,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/audit/security/[id]/+page.server.js"
);

function evt(userTier: string, id: string) {
  const base = makeEvent({ method: "GET", params: { id } });
  (base as unknown as { parent: () => Promise<unknown> }).parent = () =>
    Promise.resolve({ userTier });
  return base;
}

beforeEach(() => {
  getSecuritySnapshotFull.mockReset();
});

describe("dashboard/audit/security/[id] load()", () => {
  it("403 when tier < sa (admin)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt("admin", "7") as any)).rejects.toMatchObject({ status: 403 });
    expect(getSecuritySnapshotFull).not.toHaveBeenCalled();
  });

  it("400 when id parses to NaN", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt("sa", "abc") as any)).rejects.toMatchObject({ status: 400 });
    expect(getSecuritySnapshotFull).not.toHaveBeenCalled();
  });

  it("404 when snapshot returns null", async () => {
    getSecuritySnapshotFull.mockReturnValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt("sa", "7") as any)).rejects.toMatchObject({ status: 404 });
    expect(getSecuritySnapshotFull).toHaveBeenCalledWith("g-test", 7);
  });

  it("returns { snapshot } on hit", async () => {
    const snap = { id: 7, issuesSnapshot: [] };
    getSecuritySnapshotFull.mockReturnValue(snap);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt("sa", "7") as any)) as { snapshot: unknown };
    expect(out.snapshot).toBe(snap);
  });
});
