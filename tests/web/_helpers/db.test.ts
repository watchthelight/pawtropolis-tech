// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/_helpers/db.test.ts
 * WHAT: Smoke test for the in-memory DB helper used by dashboard route tests.
 * WHY: If the schema fixture drifts or the helper stops loading it, every
 *      downstream route test would fail with cryptic "no such table" errors.
 *      Cheaper to detect the breakage here, in one focused test.
 */

import { describe, expect, it } from "vitest";

import { makeDb } from "./db.js";

describe("makeDb", () => {
  it("returns an open database", () => {
    const db = makeDb();
    expect(db.open).toBe(true);
    db.close();
  });

  it("loads the dashboard schema (acknowledged_security_issues exists)", () => {
    const db = makeDb();
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get("acknowledged_security_issues");
    expect(row).toBeTruthy();
    db.close();
  });

  it("loads at least 20 tables (schema is comprehensive, not a stub)", () => {
    const db = makeDb();
    const count = db
      .prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table'")
      .get() as { n: number };
    expect(count.n).toBeGreaterThanOrEqual(20);
    db.close();
  });

  it("accepts writes (foreign_keys on but no query_only restriction)", () => {
    const db = makeDb();
    db.exec(
      "CREATE TEMP TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    const info = db
      .prepare("INSERT INTO smoke (value) VALUES (?)")
      .run("hello");
    expect(info.changes).toBe(1);
    const row = db.prepare("SELECT value FROM smoke WHERE id=?").get(1) as
      | { value: string }
      | undefined;
    expect(row?.value).toBe("hello");
    db.close();
  });

  it("instances are isolated (writes don't leak across makeDb calls)", () => {
    const a = makeDb();
    const b = makeDb();
    a.exec("CREATE TEMP TABLE marker_a (x INT)");
    const bHasMarkerA = b
      .prepare("SELECT name FROM sqlite_master WHERE name=?")
      .get("marker_a");
    expect(bHasMarkerA).toBeUndefined();
    a.close();
    b.close();
  });
});
