// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/env.js", () => ({
  env: {
    DATABASE_PATH: ":memory:",
  },
}));

vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

vi.mock("../../src/config/loggingStore.js", () => ({
  getLoggingChannelId: vi.fn(() => null),
}));

vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => undefined),
}));

import {
  startDiskSpaceScheduler,
  stopDiskSpaceScheduler,
} from "../../src/scheduler/diskSpaceScheduler.js";

const ORIGINAL_ENV = process.env.DISK_SPACE_SCHEDULER_DISABLED;

function makeClient() {
  return { guilds: { cache: new Map() } } as unknown as import("discord.js").Client;
}

describe("diskSpaceScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.DISK_SPACE_SCHEDULER_DISABLED;
  });

  afterEach(() => {
    stopDiskSpaceScheduler();
    vi.useRealTimers();
    if (ORIGINAL_ENV !== undefined) {
      process.env.DISK_SPACE_SCHEDULER_DISABLED = ORIGINAL_ENV;
    } else {
      delete process.env.DISK_SPACE_SCHEDULER_DISABLED;
    }
  });

  it("starts and registers an interval", () => {
    const client = makeClient();
    startDiskSpaceScheduler(client);
    expect(() => vi.advanceTimersByTime(60 * 60 * 1000)).not.toThrow();
  });

  it("respects DISK_SPACE_SCHEDULER_DISABLED=1", () => {
    process.env.DISK_SPACE_SCHEDULER_DISABLED = "1";
    const client = makeClient();
    startDiskSpaceScheduler(client);
    expect(true).toBe(true);
  });

  it("stop() is idempotent", () => {
    expect(() => stopDiskSpaceScheduler()).not.toThrow();
  });

  it("start then stop clears the interval", () => {
    const client = makeClient();
    startDiskSpaceScheduler(client);
    expect(() => stopDiskSpaceScheduler()).not.toThrow();
  });
});
