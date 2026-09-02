// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { startLoopLagMonitor, stopLoopLagMonitor, snapshotLoopLag } from "../../src/lib/loopLag.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("lib/loopLag", () => {
  afterEach(() => {
    stopLoopLagMonitor();
  });

  it("returns an empty snapshot before the monitor starts", () => {
    expect(snapshotLoopLag()).toEqual({
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      samples: 0,
      windowS: 0,
    });
  });

  it("records samples while running and resets the window on demand", async () => {
    startLoopLagMonitor();
    await sleep(120);
    const first = snapshotLoopLag(true);
    expect(first.samples).toBeGreaterThan(0);
    expect(first.p99Ms).toBeGreaterThanOrEqual(first.p50Ms);
    expect(first.maxMs).toBeGreaterThanOrEqual(first.p99Ms);
    const second = snapshotLoopLag();
    expect(second.samples).toBeLessThan(first.samples);
  });

  it("is safe to start twice and reads empty after stop", async () => {
    startLoopLagMonitor();
    startLoopLagMonitor();
    await sleep(30);
    stopLoopLagMonitor();
    expect(snapshotLoopLag().samples).toBe(0);
  });
});
