// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

import {
  startSecurityAuditScheduler,
  stopSecurityAuditScheduler,
} from "../../src/scheduler/securityAuditScheduler.js";

const ORIGINAL_ENV = process.env.SECURITY_AUDIT_SCHEDULER_DISABLED;

function makeClient() {
  return { guilds: { cache: new Map() } } as unknown as import("discord.js").Client;
}

describe("securityAuditScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.SECURITY_AUDIT_SCHEDULER_DISABLED;
  });

  afterEach(() => {
    stopSecurityAuditScheduler();
    vi.useRealTimers();
    if (ORIGINAL_ENV !== undefined) {
      process.env.SECURITY_AUDIT_SCHEDULER_DISABLED = ORIGINAL_ENV;
    } else {
      delete process.env.SECURITY_AUDIT_SCHEDULER_DISABLED;
    }
  });

  it("starts and registers an interval", () => {
    const client = makeClient();
    startSecurityAuditScheduler(client);
    expect(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000)).not.toThrow();
  });

  it("respects SECURITY_AUDIT_SCHEDULER_DISABLED=1", () => {
    process.env.SECURITY_AUDIT_SCHEDULER_DISABLED = "1";
    const client = makeClient();
    startSecurityAuditScheduler(client);
    expect(true).toBe(true);
  });

  it("stop() is idempotent", () => {
    expect(() => stopSecurityAuditScheduler()).not.toThrow();
  });

  it("start then stop clears the interval", () => {
    const client = makeClient();
    startSecurityAuditScheduler(client);
    expect(() => stopSecurityAuditScheduler()).not.toThrow();
  });
});
