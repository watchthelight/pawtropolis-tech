// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/scheduler/retentionScheduler.ts
 * WHAT: Hourly housekeeping for tables nothing else bounds: batched catch-up of the
 *       action_log FTS index, a daily `PRAGMA optimize`, and chunked deletes of expired
 *       rows. Deletes only run with RETENTION_ENABLED=true; otherwise each run logs the
 *       number of rows it would remove so the effect can be checked in prod logs first.
 * WHY: Migration 073 dropped the FTS triggers (synchronous index writes hurt the event
 *      loop), so audit search misses every row written since; and several tables grow
 *      with uptime and were never pruned.
 */

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

const TICK_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 60 * 1000;
const DAY_S = 86400;
const CHUNK = 5000;
const MAX_CHUNKS_PER_RUN = 20;

interface RetentionRule {
  table: string;
  where: string;
  params: () => unknown[];
}

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

function isoCutoff(days: number): string {
  return new Date(Date.now() - days * DAY_S * 1000).toISOString().slice(0, 19).replace("T", " ");
}

// Every rule deletes in chunks through rowid so no single statement holds the write lock
// for long. Tables are checked for existence first: test databases and fresh installs may
// not have all of them.
export const RETENTION_RULES: RetentionRule[] = [
  { table: "security_issue_history", where: "recorded_at < ?", params: () => [nowS() - 90 * DAY_S] },
  { table: "consumed_confirmations", where: "consumed_at_s < ?", params: () => [nowS() - DAY_S] },
  { table: "config_audit_log", where: "created_at < ?", params: () => [isoCutoff(365)] },
  {
    table: "member_role_snapshots",
    where: "restored_at IS NOT NULL AND removed_at < ?",
    params: () => [nowS() - 180 * DAY_S],
  },
];

function tableExists(name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
    .get(name);
}

export interface RetentionResult {
  table: string;
  candidates: number;
  deleted: number;
}

export function runRetention(enabled = process.env.RETENTION_ENABLED === "true"): RetentionResult[] {
  const results: RetentionResult[] = [];
  for (const rule of RETENTION_RULES) {
    if (!tableExists(rule.table)) continue;
    const params = rule.params();
    let candidates = 0;
    try {
      candidates = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${rule.table} WHERE ${rule.where}`).get(...params) as {
          n: number;
        }
      ).n;
    } catch (err) {
      logger.warn({ err, table: rule.table }, "[retention] candidate count failed");
      continue;
    }

    let deleted = 0;
    if (enabled && candidates > 0) {
      const del = db.prepare(
        `DELETE FROM ${rule.table} WHERE rowid IN (
           SELECT rowid FROM ${rule.table} WHERE ${rule.where} LIMIT ${CHUNK}
         )`
      );
      for (let i = 0; i < MAX_CHUNKS_PER_RUN; i++) {
        const changes = del.run(...params).changes;
        deleted += changes;
        if (changes < CHUNK) break;
      }
    }

    logger.info(
      { evt: "retention", table: rule.table, candidates, deleted, enabled },
      enabled ? "[retention] pruned expired rows" : "[retention] dry run (RETENTION_ENABLED is not true)"
    );
    results.push({ table: rule.table, candidates, deleted });
  }
  return results;
}

// High-water mark of rows already in the FTS index. Read once per process; the index only
// ever grows from here because action_log is append-only. Queries against an
// external-content FTS5 table read through to the content table, so the indexed set has
// to be read from the *_docsize shadow table, which lists exactly the indexed rowids.
let ftsHighWater: number | null = null;

/** Index action_log rows written since the last run. Returns the number of rows indexed. */
export function catchUpActionLogFts(): number {
  if (!tableExists("action_log_fts") || !tableExists("action_log_fts_docsize")) return 0;
  let mark: number =
    ftsHighWater ??
    (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM action_log_fts_docsize").get() as { n: number })
      .n;
  const nextMark = db.prepare(
    `SELECT COALESCE(MAX(id), ?) AS n FROM (
       SELECT id FROM action_log WHERE id > ? ORDER BY id LIMIT ${CHUNK}
     )`
  );
  const insert = db.prepare(
    `INSERT INTO action_log_fts(rowid, reason, app_code, actor_id, subject_id)
     SELECT id, reason, app_code, actor_id, subject_id
     FROM action_log WHERE id > ? ORDER BY id LIMIT ${CHUNK}`
  );
  const indexChunk = db.transaction((from: number): number => insert.run(from).changes);

  let total = 0;
  for (let i = 0; i < MAX_CHUNKS_PER_RUN; i++) {
    const next: number = (nextMark.get(mark, mark) as { n: number }).n;
    if (next <= mark) break;
    const changes = indexChunk(mark);
    total += changes;
    mark = next;
    if (changes < CHUNK) break;
  }
  ftsHighWater = mark;
  if (total > 0) {
    logger.info({ evt: "fts_catch_up", indexed: total, highWater: mark }, "[retention] action_log FTS caught up");
  }
  return total;
}

let lastDailyAt = 0;
let interval: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;

function tick(): void {
  const startedAt = Date.now();
  try {
    catchUpActionLogFts();
    if (Date.now() - lastDailyAt >= 24 * 60 * 60 * 1000) {
      lastDailyAt = Date.now();
      runRetention();
      try {
        db.pragma("analysis_limit = 400");
        db.pragma("optimize");
      } catch (err) {
        logger.debug({ err }, "[retention] PRAGMA optimize skipped");
      }
    }
    recordSchedulerRun("retention", true, Date.now() - startedAt);
  } catch (err) {
    recordSchedulerRun("retention", false, Date.now() - startedAt);
    logger.error({ err }, "[retention] tick failed");
  }
}

export function startRetentionScheduler(): void {
  if (process.env.RETENTION_SCHEDULER_DISABLED === "1") return;
  stopRetentionScheduler();
  initialTimer = setTimeout(tick, INITIAL_DELAY_MS);
  initialTimer.unref();
  interval = setInterval(tick, TICK_MS);
  interval.unref();
  logger.info(
    { tickMs: TICK_MS, deletesEnabled: process.env.RETENTION_ENABLED === "true" },
    "[retention] scheduler started"
  );
}

export function stopRetentionScheduler(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

/** Test hook. */
export function _resetRetentionStateForTests(): void {
  ftsHighWater = null;
  lastDailyAt = 0;
}
