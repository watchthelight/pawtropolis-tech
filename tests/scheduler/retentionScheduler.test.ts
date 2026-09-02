// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// A real in-memory database: the rules are SQL and the point is that they run.
const { dbHolder } = vi.hoisted(() => ({ dbHolder: { db: null as unknown } }));

vi.mock("../../src/db/db.js", () => ({
  get db() {
    return dbHolder.db;
  },
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/lib/schedulerHealth.js", () => ({ recordSchedulerRun: vi.fn() }));

import {
  runRetention,
  catchUpActionLogFts,
  startRetentionScheduler,
  stopRetentionScheduler,
  _resetRetentionStateForTests,
} from "../../src/scheduler/retentionScheduler.js";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE security_issue_history (id INTEGER PRIMARY KEY, guild_id TEXT, recorded_at INTEGER);
    CREATE TABLE consumed_confirmations (confirm_id TEXT PRIMARY KEY, consumed_at_s INTEGER);
    CREATE TABLE action_log (id INTEGER PRIMARY KEY AUTOINCREMENT, reason TEXT, app_code TEXT, actor_id TEXT, subject_id TEXT);
    CREATE VIRTUAL TABLE action_log_fts USING fts5(reason, app_code, actor_id, subject_id, content='action_log', content_rowid='id');
  `);
  return db;
}

describe("scheduler/retentionScheduler", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    dbHolder.db = db;
    _resetRetentionStateForTests();
    delete process.env.RETENTION_ENABLED;
    delete process.env.RETENTION_SCHEDULER_DISABLED;
  });

  afterEach(() => {
    stopRetentionScheduler();
    db.close();
  });

  it("counts expired rows but deletes nothing when retention is not enabled", () => {
    const old = Math.floor(Date.now() / 1000) - 200 * 86400;
    db.prepare("INSERT INTO security_issue_history (guild_id, recorded_at) VALUES ('g', ?)").run(old);
    db.prepare("INSERT INTO security_issue_history (guild_id, recorded_at) VALUES ('g', ?)").run(old + 199 * 86400);

    const results = runRetention(false);
    const history = results.find((r) => r.table === "security_issue_history");
    expect(history).toEqual({ table: "security_issue_history", candidates: 1, deleted: 0 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM security_issue_history").get() as { n: number }).n).toBe(2);
  });

  it("deletes only expired rows when enabled and skips tables that do not exist", () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO consumed_confirmations VALUES ('old', ?)").run(now - 3 * 86400);
    db.prepare("INSERT INTO consumed_confirmations VALUES ('fresh', ?)").run(now - 60);

    const results = runRetention(true);
    expect(results.find((r) => r.table === "consumed_confirmations")).toEqual({
      table: "consumed_confirmations",
      candidates: 1,
      deleted: 1,
    });
    expect(results.find((r) => r.table === "config_audit_log")).toBeUndefined();
    expect(db.prepare("SELECT confirm_id FROM consumed_confirmations").pluck().all()).toEqual(["fresh"]);
  });

  it("indexes action_log rows written after the FTS high-water mark, in order", () => {
    const insert = db.prepare("INSERT INTO action_log (reason, app_code, actor_id, subject_id) VALUES (?, ?, ?, ?)");
    insert.run("first reason", "AAA111", "u1", "u2");
    db.exec("INSERT INTO action_log_fts(rowid, reason, app_code, actor_id, subject_id) SELECT id, reason, app_code, actor_id, subject_id FROM action_log");
    insert.run("needle in the haystack", "BBB222", "u3", "u4");
    insert.run("another row", "CCC333", "u5", "u6");

    expect(catchUpActionLogFts()).toBe(2);
    expect(catchUpActionLogFts()).toBe(0);
    const hits = db.prepare("SELECT rowid FROM action_log_fts WHERE action_log_fts MATCH 'needle'").pluck().all();
    expect(hits).toEqual([2]);
  });

  it("runs the hourly tick on a timer and stops cleanly", () => {
    vi.useFakeTimers();
    try {
      startRetentionScheduler();
      db.prepare("INSERT INTO action_log (reason) VALUES ('late row')").run();
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      const indexed = (db.prepare("SELECT COUNT(*) AS n FROM action_log_fts").get() as { n: number }).n;
      expect(indexed).toBe(1);
      stopRetentionScheduler();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
