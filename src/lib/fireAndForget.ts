// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/lib/fireAndForget.ts
 * WHAT: Wraps a promise so it runs in the background without blocking.
 * WHY: Many operations (embed edits, deferred replies, audit logs) don't need
 *      to be awaited but SHOULD log failures instead of silently swallowing them.
 */

import { logger } from "./logger.js";

/**
 * Execute a promise without awaiting it. Failures are logged, not thrown.
 * Replaces the `.catch(() => {})` anti-pattern throughout the codebase.
 */
export function fireAndForget(promise: Promise<unknown>, label: string): void {
  promise.catch((err) => {
    logger.warn({ err, label }, `[fireAndForget] ${label} failed`);
  });
}
