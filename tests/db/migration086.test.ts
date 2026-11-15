// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/db/migration086.test.ts
 * WHAT: Verifies migration 086 drops the five score tables of the old chat
 *       study where they are empty and nowhere else, leaves every other table
 *       alone, is safe to run twice, and matches the test fixture schema.
 * WHY: The same five tables are empty leftovers on the host and hold the
 *      study's results in a developer's copy of the database. The migration
 *      runs in both places, so the one thing it must never do is drop a table
 *      that has a row in it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  migrate086DropEmptyStudyTables,
  verify086DropEmptyStudyTables,
} from "../../migrations/086_drop_empty_study_tables.js";

type Db = InstanceType<typeof Database>;

const STUDY_SCORE_TABLES = [
  "general_messages_effort",
  "general_messages_overlay_weekly",
  "general_messages_resonance",
  "general_messages_score",
  "general_messages_substantiveness",
];

function freshDb(): Db {
  const d = new Database(":memory:");
  d.exec(
    `CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`
  );
  return d;
}

/**
 * A database with the five tables as the study's scripts create them, one of
 * the study's other tables and user_names. Nothing has a row.
 */
function studyDb(): Db {
  const d = freshDb();
  d.exec(`
    CREATE TABLE general_messages_effort (
      id TEXT PRIMARY KEY, created_at_s INTEGER NOT NULL, score REAL NOT NULL, model TEXT NOT NULL
    );
    CREATE INDEX idx_gme_time ON general_messages_effort(created_at_s);
    CREATE INDEX idx_gme_time_id_score ON general_messages_effort(created_at_s, id, score);
    CREATE TABLE general_messages_resonance (
      id TEXT PRIMARY KEY, created_at_s INTEGER NOT NULL, reply_count INTEGER NOT NULL, score REAL NOT NULL
    );
    CREATE INDEX idx_gmres_time ON general_messages_resonance(created_at_s);
    CREATE TABLE general_messages_score (
      id TEXT PRIMARY KEY, created_at_s INTEGER NOT NULL, score REAL NOT NULL, features TEXT NOT NULL
    );
    CREATE INDEX idx_gms_time ON general_messages_score(created_at_s);
    CREATE TABLE general_messages_substantiveness (
      id TEXT PRIMARY KEY, created_at_s INTEGER NOT NULL, score REAL NOT NULL
    );
    CREATE INDEX idx_subst_time ON general_messages_substantiveness(created_at_s);
    CREATE TABLE general_messages_overlay_weekly (
      week_start INTEGER PRIMARY KEY, count INTEGER NOT NULL, effort REAL NOT NULL
    );
    CREATE TABLE general_messages_raw (
      id TEXT PRIMARY KEY, created_at_s INTEGER NOT NULL, content TEXT NOT NULL
    );
    CREATE INDEX idx_gmr_time ON general_messages_raw(created_at_s);
    CREATE TABLE user_names (id TEXT PRIMARY KEY, display TEXT NOT NULL);
  `);
  return d;
}

function fixtureDb(): Db {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = OFF");
  d.exec(readFileSync(path.join("tests", "fixtures", "schema.sql"), "utf8"));
  return d;
}

const names = (d: Db, type: "table" | "index") =>
  (
    d.prepare(`SELECT name FROM sqlite_master WHERE type = ? ORDER BY name`).all(type) as {
      name: string;
    }[]
  ).map((row) => row.name);

const count = (d: Db, table: string) =>
  (d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("migration 086: drop the empty score tables of the old study", () => {
  it("drops the five tables when they are empty, their indexes with them, and nothing else", () => {
    const d = studyDb();
    const tablesBefore = names(d, "table");
    const indexesBefore = names(d, "index");
    expect(tablesBefore).toEqual(expect.arrayContaining(STUDY_SCORE_TABLES));

    migrate086DropEmptyStudyTables(d);

    const tablesAfter = names(d, "table");
    expect(tablesBefore.filter((name) => !tablesAfter.includes(name))).toEqual(STUDY_SCORE_TABLES);
    expect(tablesAfter.filter((name) => !tablesBefore.includes(name))).toEqual([]);
    expect(tablesAfter).toEqual(
      expect.arrayContaining(["general_messages_raw", "user_names", "schema_migrations"])
    );
    expect(indexesBefore.filter((name) => !names(d, "index").includes(name))).toEqual([
      "idx_gme_time",
      "idx_gme_time_id_score",
      "idx_gmres_time",
      "idx_gms_time",
      "idx_subst_time",
      "sqlite_autoindex_general_messages_effort_1",
      "sqlite_autoindex_general_messages_resonance_1",
      "sqlite_autoindex_general_messages_score_1",
      "sqlite_autoindex_general_messages_substantiveness_1",
    ]);
    d.close();
  });

  it("keeps a table that holds a row, with the row and its indexes", () => {
    const d = studyDb();
    d.exec(`
      INSERT INTO general_messages_effort (id, created_at_s, score, model) VALUES ('1', 100, 0.5, 'v1');
      INSERT INTO general_messages_overlay_weekly (week_start, count, effort) VALUES (604800, 12, 0.4);
    `);

    migrate086DropEmptyStudyTables(d);

    expect(names(d, "table").filter((name) => STUDY_SCORE_TABLES.includes(name))).toEqual([
      "general_messages_effort",
      "general_messages_overlay_weekly",
    ]);
    expect(d.prepare(`SELECT * FROM general_messages_effort`).all()).toEqual([
      { id: "1", created_at_s: 100, score: 0.5, model: "v1" },
    ]);
    expect(count(d, "general_messages_overlay_weekly")).toBe(1);
    expect(names(d, "index")).toEqual(
      expect.arrayContaining(["idx_gme_time", "idx_gme_time_id_score"])
    );
    expect(verify086DropEmptyStudyTables(d)).toBe(true);
    d.close();
  });

  it("leaves the study's other tables and user_names alone, empty or not", () => {
    const d = studyDb();
    migrate086DropEmptyStudyTables(d);
    expect(names(d, "table")).toEqual(
      expect.arrayContaining(["general_messages_raw", "user_names"])
    );
    expect(names(d, "index")).toContain("idx_gmr_time");

    const filled = studyDb();
    filled.exec(`
      INSERT INTO general_messages_raw (id, created_at_s, content) VALUES ('1', 100, 'made up');
      INSERT INTO user_names (id, display) VALUES ('1', 'Someone');
    `);
    migrate086DropEmptyStudyTables(filled);
    expect(count(filled, "general_messages_raw")).toBe(1);
    expect(count(filled, "user_names")).toBe(1);
    d.close();
    filled.close();
  });

  it("is safe to run twice and stamps the version once", () => {
    const d = studyDb();
    migrate086DropEmptyStudyTables(d);

    expect(() => migrate086DropEmptyStudyTables(d)).not.toThrow();

    expect(names(d, "table").filter((name) => STUDY_SCORE_TABLES.includes(name))).toEqual([]);
    const stamps = d
      .prepare(`SELECT version, name FROM schema_migrations WHERE version = '086'`)
      .all();
    expect(stamps).toEqual([{ version: "086", name: "drop_empty_study_tables" }]);
    d.close();
  });

  it("runs on a database that has none of the tables", () => {
    const d = freshDb();

    expect(() => migrate086DropEmptyStudyTables(d)).not.toThrow();

    expect(names(d, "table")).toEqual(["schema_migrations"]);
    expect(verify086DropEmptyStudyTables(d)).toBe(true);
    d.close();
  });

  it("post-condition fails while one of the five is there and empty", () => {
    const d = studyDb();
    expect(verify086DropEmptyStudyTables(d)).toBe(false);

    migrate086DropEmptyStudyTables(d);
    expect(verify086DropEmptyStudyTables(d)).toBe(true);

    d.exec(`CREATE TABLE general_messages_score (id TEXT PRIMARY KEY, score REAL NOT NULL)`);
    expect(verify086DropEmptyStudyTables(d)).toBe(false);

    d.exec(`INSERT INTO general_messages_score (id, score) VALUES ('1', 0.5)`);
    expect(verify086DropEmptyStudyTables(d)).toBe(true);
    d.close();
  });

  // The fixture has no rows, so it is a database the migration empties of the five.
  it("matches the test fixture schema", () => {
    const fixture = fixtureDb();
    const before = names(fixture, "table");
    expect(before.filter((name) => STUDY_SCORE_TABLES.includes(name))).toEqual([]);
    expect(before).toEqual(expect.arrayContaining(["general_messages_raw", "user_names"]));
    expect(
      (
        fixture
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN (${STUDY_SCORE_TABLES.map(() => "?").join(", ")})`
          )
          .all(...STUDY_SCORE_TABLES) as { name: string }[]
      ).map((row) => row.name)
    ).toEqual([]);

    migrate086DropEmptyStudyTables(fixture);

    expect(names(fixture, "table")).toEqual(before);
    fixture.close();
  });
});
