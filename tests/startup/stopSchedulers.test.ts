// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/startup/stopSchedulers.test.ts
 * WHAT: stopSchedulers isolates each stop.
 * WHY: One throwing stop used to skip every later stop and, via the shutdown
 *      handler's outer catch, the buffer flushes and db.close().
 */

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  first: vi.fn(),
  middle: vi.fn(),
  last: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/scheduler/modMetricsScheduler.js", () => ({ stopModMetricsScheduler: h.first }));
vi.mock("../../src/scheduler/guildSnapshotScheduler.js", () => ({ stopGuildSnapshotScheduler: vi.fn() }));
vi.mock("../../src/scheduler/opsHealthScheduler.js", () => ({ stopOpsHealthScheduler: vi.fn() }));
vi.mock("../../src/scheduler/staleApplicationCheck.js", () => ({ stopStaleApplicationScheduler: vi.fn() }));
vi.mock("../../src/scheduler/securityAuditScheduler.js", () => ({ stopSecurityAuditScheduler: h.middle }));
vi.mock("../../src/scheduler/byteMultiplierScheduler.js", () => ({ stopByteMultiplierCleanup: vi.fn() }));
vi.mock("../../src/scheduler/diskSpaceScheduler.js", () => ({ stopDiskSpaceScheduler: vi.fn() }));
vi.mock("../../src/scheduler/eventTimeoutScheduler.js", () => ({ stopEventTimeoutScheduler: vi.fn() }));
vi.mock("../../src/scheduler/badgeRefreshScheduler.js", () => ({ stopBadgeRefreshScheduler: vi.fn() }));
vi.mock("../../src/scheduler/messageActivityPruneScheduler.js", () => ({
  stopMessageActivityPruneScheduler: vi.fn(),
}));
vi.mock("../../src/scheduler/itemCaptureScheduler.js", () => ({ stopItemCaptureScheduler: vi.fn() }));
vi.mock("../../src/scheduler/dbIntegrityScheduler.js", () => ({ stopDbIntegrityScheduler: vi.fn() }));
vi.mock("../../src/scheduler/retentionScheduler.js", () => ({ stopRetentionScheduler: h.last }));

import { stopSchedulers } from "../../src/startup/schedulers.js";

describe("stopSchedulers", () => {
  it("keeps stopping the remaining schedulers when one throws", async () => {
    h.first.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(stopSchedulers()).resolves.toBeUndefined();

    expect(h.middle).toHaveBeenCalledTimes(1);
    expect(h.last).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledWith(
      expect.objectContaining({ step: "stopModMetricsScheduler" }),
      expect.stringContaining("scheduler stop failed")
    );
  });
});
