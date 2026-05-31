// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/scheduler/messageActivityPruneScheduler.test.ts
 * Verifies the daily message_activity retention sweep actually runs pruneOldMessages
 * for every guild on startup and on each interval tick (#00250).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

const { mockPrune } = vi.hoisted(() => ({ mockPrune: vi.fn(() => 0) }));
vi.mock("../../src/features/messageActivityLogger.js", () => ({
  pruneOldMessages: mockPrune,
}));

import {
  startMessageActivityPruneScheduler,
  stopMessageActivityPruneScheduler,
} from "../../src/scheduler/messageActivityPruneScheduler.js";
import { recordSchedulerRun } from "../../src/lib/schedulerHealth.js";

function makeClient(guildIds: string[]) {
  const cache = new Map(guildIds.map((id) => [id, { id }]));
  return { guilds: { cache } } as unknown as import("discord.js").Client;
}

describe("messageActivityPruneScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopMessageActivityPruneScheduler();
    vi.useRealTimers();
  });

  it("prunes every guild on startup with the 90-day window", () => {
    startMessageActivityPruneScheduler(makeClient(["g1", "g2"]));

    expect(mockPrune).toHaveBeenCalledTimes(2);
    expect(mockPrune).toHaveBeenCalledWith("g1", 90);
    expect(mockPrune).toHaveBeenCalledWith("g2", 90);
    expect(recordSchedulerRun).toHaveBeenCalledWith("messageActivityPrune", true);
  });

  it("prunes again on the daily interval", () => {
    startMessageActivityPruneScheduler(makeClient(["g1"]));
    expect(mockPrune).toHaveBeenCalledTimes(1); // startup sweep

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(mockPrune).toHaveBeenCalledTimes(2); // one interval tick
  });

  it("stop halts further sweeps", () => {
    startMessageActivityPruneScheduler(makeClient(["g1"]));
    stopMessageActivityPruneScheduler();
    mockPrune.mockClear();

    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);
    expect(mockPrune).not.toHaveBeenCalled();
  });

  it("a failing guild prune does not abort the sweep", () => {
    mockPrune.mockImplementationOnce(() => {
      throw new Error("db locked");
    });
    startMessageActivityPruneScheduler(makeClient(["g1", "g2"]));

    // g1 throws, g2 still pruned.
    expect(mockPrune).toHaveBeenCalledTimes(2);
    expect(recordSchedulerRun).toHaveBeenCalledWith("messageActivityPrune", true);
  });
});
