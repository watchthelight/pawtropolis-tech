// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/audit.findings.test.ts
 * WHAT: Unit tests for dashboard/audit/findings/+page.server.ts load().
 * WHY: Tiny load() but unguarded; locks the single-call shape so query
 *      contract drift surfaces.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { getAuditRuns } = vi.hoisted(() => ({ getAuditRuns: vi.fn() }));

vi.mock("$lib/server/queries/auditSystems", () => ({ getAuditRuns }));

const { load } = await import(
  "../../../web/src/routes/dashboard/audit/findings/+page.server.js"
);

beforeEach(() => {
  getAuditRuns.mockReset();
});

describe("dashboard/audit/findings load()", () => {
  it("returns { runs } from getAuditRuns", async () => {
    const runs = [{ id: "r1" }, { id: "r2" }];
    getAuditRuns.mockReturnValue(runs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(makeEvent({ method: "GET" }) as any)) as { runs: unknown[] };
    expect(out.runs).toBe(runs);
    expect(getAuditRuns).toHaveBeenCalledOnce();
  });
});
