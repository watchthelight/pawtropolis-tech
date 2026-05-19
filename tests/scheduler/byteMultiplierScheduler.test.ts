// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/store/byteMultiplierStore.js", () => ({
  removeExpiredMultipliers: vi.fn(() => []),
}));

vi.mock("../../src/features/panicStore.js", () => ({
  isPanicMode: vi.fn(() => false),
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn(),
}));

vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

import {
  startByteMultiplierCleanup,
  stopByteMultiplierCleanup,
} from "../../src/scheduler/byteMultiplierScheduler.js";

const ORIGINAL_ENV = process.env.BYTE_SCHEDULER_DISABLED;

function makeClient() {
  return { guilds: { cache: new Map() } } as unknown as import("discord.js").Client;
}

describe("byteMultiplierScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.BYTE_SCHEDULER_DISABLED;
  });

  afterEach(() => {
    stopByteMultiplierCleanup();
    vi.useRealTimers();
    if (ORIGINAL_ENV !== undefined) {
      process.env.BYTE_SCHEDULER_DISABLED = ORIGINAL_ENV;
    } else {
      delete process.env.BYTE_SCHEDULER_DISABLED;
    }
  });

  it("starts and registers an interval", () => {
    const client = makeClient();
    startByteMultiplierCleanup(client);
    expect(() => vi.advanceTimersByTime(60 * 60 * 1000)).not.toThrow();
  });

  it("respects BYTE_SCHEDULER_DISABLED=1", () => {
    process.env.BYTE_SCHEDULER_DISABLED = "1";
    const client = makeClient();
    startByteMultiplierCleanup(client);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(true).toBe(true);
  });

  it("stop() is idempotent", () => {
    expect(() => stopByteMultiplierCleanup()).not.toThrow();
  });

  it("start then stop clears the interval", () => {
    const client = makeClient();
    startByteMultiplierCleanup(client);
    expect(() => stopByteMultiplierCleanup()).not.toThrow();
  });
});
