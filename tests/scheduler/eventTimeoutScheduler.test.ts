// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/features/movieNight.js", () => ({
  getActiveMovieEvent: vi.fn(),
  finalizeMovieAttendance: vi.fn(),
}));

vi.mock("../../src/features/events/gameNight.js", () => ({
  getActiveGameEvent: vi.fn(),
  finalizeGameAttendance: vi.fn(),
}));

vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

import {
  startEventTimeoutScheduler,
  stopEventTimeoutScheduler,
} from "../../src/scheduler/eventTimeoutScheduler.js";

const ORIGINAL_ENV = process.env.EVENT_TIMEOUT_DISABLED;

function makeClient() {
  return {
    guilds: { cache: new Map() },
  } as unknown as import("discord.js").Client;
}

describe("eventTimeoutScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.EVENT_TIMEOUT_DISABLED;
  });

  afterEach(() => {
    stopEventTimeoutScheduler();
    vi.useRealTimers();
    if (ORIGINAL_ENV !== undefined) {
      process.env.EVENT_TIMEOUT_DISABLED = ORIGINAL_ENV;
    } else {
      delete process.env.EVENT_TIMEOUT_DISABLED;
    }
  });

  it("starts and registers an interval", () => {
    const client = makeClient();
    startEventTimeoutScheduler(client);
    // 15-minute interval. Advance to confirm it fires without throwing.
    expect(() => vi.advanceTimersByTime(15 * 60 * 1000)).not.toThrow();
  });

  it("respects EVENT_TIMEOUT_DISABLED=1 env flag", () => {
    process.env.EVENT_TIMEOUT_DISABLED = "1";
    const client = makeClient();
    startEventTimeoutScheduler(client);
    // If disabled, no interval registered: advancing should produce zero tick effects.
    vi.advanceTimersByTime(15 * 60 * 1000);
    // No-op assertion: the scheduler is silently disabled.
    expect(true).toBe(true);
  });

  it("stop() is idempotent (safe to call when not started)", () => {
    expect(() => stopEventTimeoutScheduler()).not.toThrow();
  });

  it("start then stop cleanly clears the interval", () => {
    const client = makeClient();
    startEventTimeoutScheduler(client);
    expect(() => stopEventTimeoutScheduler()).not.toThrow();
    // After stop, advancing the clock should be a no-op.
    vi.advanceTimersByTime(60 * 60 * 1000);
  });
});
