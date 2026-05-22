// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/audit.findings.runId.test.ts
 * WHAT: Unit tests for dashboard/audit/findings/[runId]/+page.server.ts load().
 * WHY: Pins the 404-when-empty branch (length === 0) and the runId pass-through
 *      to both query functions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { getAuditRunFindings, getAuditRunStats } = vi.hoisted(() => ({
  getAuditRunFindings: vi.fn(),
  getAuditRunStats: vi.fn(),
}));

vi.mock("$lib/server/queries/auditSystems", () => ({
  getAuditRunFindings,
  getAuditRunStats,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/audit/findings/[runId]/+page.server.js"
);

function evt() {
  return makeEvent({ method: "GET", params: { runId: "run-1" } });
}

beforeEach(() => {
  getAuditRunFindings.mockReset();
  getAuditRunStats.mockReset();
});

describe("dashboard/audit/findings/[runId] load()", () => {
  it("404 when findings array is empty", async () => {
    getAuditRunFindings.mockReturnValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt() as any)).rejects.toMatchObject({ status: 404 });
    expect(getAuditRunFindings).toHaveBeenCalledWith("run-1");
    expect(getAuditRunStats).not.toHaveBeenCalled();
  });

  it("returns runId + findings + stats on hit", async () => {
    const findings = [{ id: "f1" }];
    const stats = { total: 1 };
    getAuditRunFindings.mockReturnValue(findings);
    getAuditRunStats.mockReturnValue(stats);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt() as any)) as Record<string, unknown>;
    expect(out).toEqual({ runId: "run-1", findings, stats });
    expect(getAuditRunStats).toHaveBeenCalledWith("run-1");
  });
});
