// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/startup/runStartupTask.test.ts
 * WHAT: Unit tests for the startup task wrapper.
 * WHY: Every ClientReady step that fails-soft routes through this helper.
 *      A regression here would cause one failed task to abort startup,
 *      leaving the bot in a half-up state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

import { runStartupTask } from "../../src/startup/runStartupTask.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runStartupTask", () => {
  it("returns true when the task resolves", async () => {
    const ok = await runStartupTask("ok_task", async () => {
      // pass
    });
    expect(ok).toBe(true);
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("returns true for synchronous success", async () => {
    const ok = await runStartupTask("sync_ok", () => {
      // pass
    });
    expect(ok).toBe(true);
  });

  it("returns false and logs at error level by default when the task throws", async () => {
    const ok = await runStartupTask("boom", async () => {
      throw new Error("kapow");
    });
    expect(ok).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "startup_task_failed",
        task: "boom",
        err: expect.any(Error),
      }),
      expect.stringContaining("boom failed"),
    );
  });

  it("uses warn level when level=warn is passed", async () => {
    const ok = await runStartupTask(
      "soft_boom",
      async () => {
        throw new Error("nope");
      },
      { level: "warn" },
    );
    expect(ok).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "startup_task_failed",
        task: "soft_boom",
      }),
      expect.stringContaining("soft_boom failed"),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("merges extra context into the log line", async () => {
    await runStartupTask(
      "with_ctx",
      async () => {
        throw new Error("err");
      },
      { context: { guildId: "g1", attempt: 3 } },
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "startup_task_failed",
        task: "with_ctx",
        guildId: "g1",
        attempt: 3,
      }),
      expect.any(String),
    );
  });

  it("treats sync throws the same as async throws", async () => {
    const ok = await runStartupTask("sync_throw", () => {
      throw new Error("sync boom");
    });
    expect(ok).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("does not propagate the error to the caller", async () => {
    // The whole point is fail-soft: callers get a boolean, never an exception.
    await expect(
      runStartupTask("never_throws", async () => {
        throw new Error("would have thrown");
      }),
    ).resolves.toBe(false);
  });

  it("isolates failure between sequential tasks", async () => {
    // Simulate ClientReady running several tasks back to back. One failure
    // must not prevent later tasks from running.
    const order: string[] = [];

    await runStartupTask("a", () => {
      order.push("a");
    });
    await runStartupTask("b", () => {
      order.push("b");
      throw new Error("b fails");
    });
    await runStartupTask("c", () => {
      order.push("c");
    });

    expect(order).toEqual(["a", "b", "c"]);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ task: "b" }),
      expect.any(String),
    );
  });
});
