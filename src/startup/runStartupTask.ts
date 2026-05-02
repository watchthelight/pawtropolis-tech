// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/startup/runStartupTask.ts
 * WHAT: Wraps a single startup task with the standard try / catch / log pattern.
 * WHY: src/index.ts has dozens of try/catch blocks during ClientReady, all
 *      following the same fail-soft shape: run a task, log the outcome at
 *      either info or warn level, never let one failed task prevent the
 *      bot from finishing startup. Centralizing the pattern makes the
 *      behavior auditable and lets tests verify failure isolation.
 *
 * Usage:
 *   await runStartupTask("schema_self_heal", async () => {
 *     ensureAvatarScanSchema();
 *     ensureApplicationPermaRejectColumn();
 *   });
 *
 * If the task throws, the error is logged at error level with evt:startup_task_failed
 * and the function resolves to false. Callers do not need to wrap the call
 * in their own try/catch.
 */

import { logger } from "../lib/logger.js";

export interface StartupTaskOptions {
  /**
   * Log level used when the task throws. Defaults to "error". Some tasks
   * (e.g. optional schedulers, banner sync) explicitly want warn-only.
   */
  level?: "warn" | "error";
  /**
   * Extra structured context to include in the log line on failure.
   */
  context?: Record<string, unknown>;
}

export async function runStartupTask(
  name: string,
  fn: () => void | Promise<void>,
  options: StartupTaskOptions = {},
): Promise<boolean> {
  const level = options.level ?? "error";
  try {
    await fn();
    return true;
  } catch (err) {
    const meta = {
      evt: "startup_task_failed",
      task: name,
      err,
      ...(options.context ?? {}),
    };
    if (level === "warn") {
      logger.warn(meta, `[startup] ${name} failed (non-fatal)`);
    } else {
      logger.error(meta, `[startup] ${name} failed`);
    }
    return false;
  }
}
