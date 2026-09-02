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

import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { SnowflakeUtil, type Client } from "discord.js";
import { db } from "../db/db.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";
import {
  getVerifyLogChannelId,
  VERIFY_LOG_DOCUMENT_TITLE_PREFIX,
  VERIFY_LOG_EMBED_TITLE,
} from "../features/verifyLog.js";

const TICK_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 60 * 1000;
const DAY_S = 86400;
const CHUNK = 5000;
const MAX_CHUNKS_PER_RUN = 20;
// Deploy backups: keep this many newest plus anything younger than the age limit.
const BACKUPS_KEEP_NEWEST = 3;
const BACKUPS_KEEP_DAYS = 7;
// Verification review posts (identity documents) are removed after this long.
const VERIFY_LOG_KEEP_DAYS = 30;
const VERIFY_LOG_MAX_DELETES_PER_RUN = 50;

function retentionEnabled(): boolean {
  return process.env.RETENTION_ENABLED === "true";
}

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
const RETENTION_RULES: RetentionRule[] = [
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

export function runRetention(enabled = retentionEnabled()): RetentionResult[] {
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

export interface BackupPruneResult {
  dir: string;
  candidates: number;
  candidateBytes: number;
  deleted: number;
}

/**
 * Deploy backups (`data/backups/data.db.<timestamp>` plus their -wal/-shm siblings). Keep
 * the newest BACKUPS_KEEP_NEWEST database copies and anything younger than
 * BACKUPS_KEEP_DAYS; delete the rest when retention is enabled. The host filled to 83%
 * because nothing ever pruned these.
 */
export function pruneDeployBackups(
  dir: string = env.DB_BACKUPS_DIR,
  enabled = retentionEnabled(),
  now = Date.now()
): BackupPruneResult {
  const result: BackupPruneResult = { dir, candidates: 0, candidateBytes: 0, deleted: 0 };
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.startsWith("data.db."));
  } catch {
    return result;
  }
  // Group a backup with its -wal/-shm siblings so they are kept or removed together.
  const groups = new Map<string, { files: string[]; mtimeMs: number; bytes: number }>();
  for (const name of names) {
    const base = name.replace(/-(wal|shm)$/, "");
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    const g = groups.get(base) ?? { files: [], mtimeMs: 0, bytes: 0 };
    g.files.push(full);
    g.bytes += st.size;
    g.mtimeMs = Math.max(g.mtimeMs, st.mtimeMs);
    groups.set(base, g);
  }
  const ordered = [...groups.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cutoff = now - BACKUPS_KEEP_DAYS * DAY_S * 1000;
  ordered.slice(BACKUPS_KEEP_NEWEST).forEach((g) => {
    if (g.mtimeMs >= cutoff) return;
    result.candidates++;
    result.candidateBytes += g.bytes;
    if (!enabled) return;
    for (const file of g.files) {
      try {
        unlinkSync(file);
      } catch (err) {
        logger.warn({ err, file }, "[retention] failed to delete backup file");
      }
    }
    result.deleted++;
  });
  logger.info(
    { evt: "retention_backups", ...result, enabled },
    enabled ? "[retention] pruned deploy backups" : "[retention] backup dry run"
  );
  return result;
}

/**
 * Verification review posts carry identity document images; remove the bot's own posts
 * older than VERIFY_LOG_KEEP_DAYS. Bulk delete cannot reach messages older than 14 days, so
 * they go one at a time, capped per run. Runs only when retention is enabled.
 */
async function pruneVerifyLog(client: Client, enabled = retentionEnabled()): Promise<number> {
  if (!enabled || !client.user) return 0;
  const channelId = getVerifyLogChannelId();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return 0;

  const cutoff = SnowflakeUtil.generate({
    timestamp: Date.now() - VERIFY_LOG_KEEP_DAYS * DAY_S * 1000,
  }).toString();
  const messages = await channel.messages.fetch({ limit: 100, before: cutoff }).catch(() => null);
  if (!messages) return 0;

  let deleted = 0;
  for (const message of messages.values()) {
    if (deleted >= VERIFY_LOG_MAX_DELETES_PER_RUN) break;
    if (message.author.id !== client.user.id) continue;
    const title = message.embeds[0]?.title ?? "";
    if (title !== VERIFY_LOG_EMBED_TITLE && !title.startsWith(VERIFY_LOG_DOCUMENT_TITLE_PREFIX)) continue;
    try {
      await message.delete();
      deleted++;
    } catch (err) {
      logger.warn({ err, messageId: message.id }, "[retention] failed to delete verification post");
    }
  }
  if (deleted > 0) {
    logger.info({ evt: "retention_verify_log", deleted, channelId }, "[retention] pruned verification posts");
  }
  return deleted;
}

let lastDailyAt = 0;
let interval: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let clientRef: Client | null = null;
let running = false;

function tick(): void {
  const startedAt = Date.now();
  try {
    catchUpActionLogFts();
    if (Date.now() - lastDailyAt >= 24 * 60 * 60 * 1000) {
      lastDailyAt = Date.now();
      runRetention();
      pruneDeployBackups();
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

  // The Discord side runs after the synchronous work and never overlaps itself.
  if (clientRef && !running) {
    running = true;
    pruneVerifyLog(clientRef)
      .catch((err) => logger.warn({ err }, "[retention] verification log prune failed"))
      .finally(() => {
        running = false;
      });
  }
}

export function startRetentionScheduler(client?: Client): void {
  if (process.env.RETENTION_SCHEDULER_DISABLED === "1") return;
  stopRetentionScheduler();
  clientRef = client ?? null;
  initialTimer = setTimeout(tick, INITIAL_DELAY_MS);
  initialTimer.unref();
  interval = setInterval(tick, TICK_MS);
  interval.unref();
  logger.info(
    { tickMs: TICK_MS, deletesEnabled: retentionEnabled() },
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
  clientRef = null;
  running = false;
}
