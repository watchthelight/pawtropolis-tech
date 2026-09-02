// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { refreshMock, recordMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  recordMock: vi.fn(),
}));

vi.mock("../../src/lib/dbIntegrityCheck.js", () => ({ refreshDbIntegrity: refreshMock }));
vi.mock("../../src/lib/schedulerHealth.js", () => ({ recordSchedulerRun: recordMock }));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  startDbIntegrityScheduler,
  stopDbIntegrityScheduler,
} from "../../src/scheduler/dbIntegrityScheduler.js";

describe("scheduler/dbIntegrityScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockResolvedValue({
      ok: true,
      message: "ok",
      checkedAt: 1,
      durationMs: 5,
      mode: "quick",
    });
    delete process.env.DB_INTEGRITY_SCHEDULER_DISABLED;
    delete process.env.DB_INTEGRITY_INTERVAL_HOURS;
  });

  afterEach(() => {
    stopDbIntegrityScheduler();
    vi.useRealTimers();
  });

  it("runs the first check after the startup delay and then every interval", async () => {
    startDbIntegrityScheduler();
    expect(refreshMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 3600_000);
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(recordMock).toHaveBeenLastCalledWith("dbIntegrity", true, expect.any(Number));
  });

  it("honours DB_INTEGRITY_INTERVAL_HOURS", async () => {
    process.env.DB_INTEGRITY_INTERVAL_HOURS = "1";
    startDbIntegrityScheduler();
    await vi.advanceTimersByTimeAsync(3600_000 + 5 * 60_000);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing when disabled", async () => {
    process.env.DB_INTEGRITY_SCHEDULER_DISABLED = "1";
    startDbIntegrityScheduler();
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("stop clears both timers", async () => {
    startDbIntegrityScheduler();
    stopDbIntegrityScheduler();
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
