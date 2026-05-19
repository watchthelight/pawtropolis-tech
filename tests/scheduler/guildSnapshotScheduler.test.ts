// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

import {
  startGuildSnapshotScheduler,
  stopGuildSnapshotScheduler,
} from "../../src/scheduler/guildSnapshotScheduler.js";

function makeClient() {
  return { guilds: { cache: new Map() } } as unknown as import("discord.js").Client;
}

describe("guildSnapshotScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopGuildSnapshotScheduler();
    vi.useRealTimers();
  });

  it("starts and registers an interval", () => {
    const client = makeClient();
    startGuildSnapshotScheduler(client);
    expect(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000)).not.toThrow();
  });

  it("stop() is idempotent", () => {
    expect(() => stopGuildSnapshotScheduler()).not.toThrow();
  });

  it("start then stop clears the interval", () => {
    const client = makeClient();
    startGuildSnapshotScheduler(client);
    expect(() => stopGuildSnapshotScheduler()).not.toThrow();
  });
});
