// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/lib/loopLag.ts
 * WHAT: Event-loop delay monitor. Samples how late timers fire and reports percentiles.
 * WHY: Every "application did not respond" so far traced back to a blocked event loop.
 *      Without a number for it each optimisation is a guess. The ops health summary and a
 *      warn log carry p50/p95/p99 so before/after comparisons come straight from prod logs.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { logger } from "./logger.js";

export interface LoopLagSnapshot {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  samples: number;
  windowS: number;
}

const RESOLUTION_MS = 10;
const WARN_P99_MS = parseInt(process.env.LOOP_LAG_WARN_P99_MS ?? "250", 10);

let histogram: IntervalHistogram | null = null;
let windowStartedAt = 0;

export function startLoopLagMonitor(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  windowStartedAt = Date.now();
}

export function stopLoopLagMonitor(): void {
  histogram?.disable();
  histogram = null;
}

// The histogram records the interval between samples, so an idle loop reads as the
// resolution itself. Subtract it to report only the delay the loop added.
function toLagMs(ns: number): number {
  const ms = ns / 1e6 - RESOLUTION_MS;
  return ms > 0 ? Math.round(ms * 10) / 10 : 0;
}

const EMPTY: LoopLagSnapshot = { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, samples: 0, windowS: 0 };

/**
 * Percentiles for the current window. `reset` starts a new window, which the 60s ops
 * health tick uses so each snapshot covers one minute; ad-hoc readers leave it false.
 */
export function snapshotLoopLag(reset = false): LoopLagSnapshot {
  if (!histogram || histogram.count === 0) return EMPTY;
  const snap: LoopLagSnapshot = {
    p50Ms: toLagMs(histogram.percentile(50)),
    p95Ms: toLagMs(histogram.percentile(95)),
    p99Ms: toLagMs(histogram.percentile(99)),
    maxMs: toLagMs(histogram.max),
    samples: histogram.count,
    windowS: Math.round((Date.now() - windowStartedAt) / 1000),
  };
  if (reset) {
    histogram.reset();
    windowStartedAt = Date.now();
  }
  if (snap.p99Ms >= WARN_P99_MS) {
    logger.warn({ evt: "loop_lag", ...snap }, "[loopLag] event loop p99 delay above threshold");
  }
  return snap;
}
