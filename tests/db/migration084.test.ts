// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/db/migration084.test.ts
 * WHAT: Verifies migration 084 creates the /investigate-artist usage ledger and
 *       lookup cache, is safe to run twice, and matches the test fixture schema.
 * WHY: The monthly budget guard sums the ledger. A missing table or a changed
 *      column would either block every run or let spend go uncounted. The
 *      fixture is written by hand, so it is compared with the migration here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  migrate084ArtistInvestigation,
  verify084ArtistInvestigation,
} from "../../migrations/084_artist_investigation.js";

type Db = InstanceType<typeof Database>;

function freshDb(): Db {
  const d = new Database(":memory:");
  d.exec(
    `CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`
  );
  return d;
}

function fixtureDb(): Db {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = OFF");
  d.exec(readFileSync(path.join("tests", "fixtures", "schema.sql"), "utf8"));
  return d;
}

interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const columns = (d: Db, table: string) =>
  (d.pragma(`table_info(${table})`) as Column[]).map(({ name, type, notnull, dflt_value, pk }) => ({
    name,
    type,
    notnull,
    dflt_value,
    pk,
  }));

const TABLES = ["artist_investigation_run", "artist_provenance_cache"];

describe("migration 084: artist investigation", () => {
  it("creates the ledger, its index and the lookup cache", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);

    for (const table of TABLES) {
      const row = d
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
        .get(table);
      expect(row, `missing table ${table}`).toBeTruthy();
    }
    const index = d
      .prepare(
        `SELECT tbl_name FROM sqlite_master WHERE type='index' AND name = 'idx_artist_investigation_run_created'`
      )
      .get() as { tbl_name: string } | undefined;
    expect(index?.tbl_name).toBe("artist_investigation_run");
    d.close();
  });

  it("gives the ledger a column for everything the budget guard and the footer need", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);

    expect(columns(d, "artist_investigation_run").map((c) => c.name)).toEqual([
      "id",
      "guild_id",
      "channel_id",
      "invoked_by",
      "model",
      "status",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "cost_usd",
      "image_count",
      "lookup_count",
      "created_at_s",
    ]);
    d.close();
  });

  it("holds nothing from the ticket itself: no column for text, names or image links", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);

    const names = columns(d, "artist_investigation_run").map((c) => c.name);
    expect(
      names.filter((name) => /content|text|transcript|applicant|user_id|url|report/.test(name))
    ).toEqual([]);
    d.close();
  });

  it("fills in zero counts and the current time when a row leaves them out", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);
    const before = Math.floor(Date.now() / 1000);

    d.prepare(
      `INSERT INTO artist_investigation_run (guild_id, channel_id, invoked_by, model, status) VALUES ('g', 'c', 'u', 'm', 'ok')`
    ).run();
    const row = d.prepare(`SELECT * FROM artist_investigation_run`).get() as Record<
      string,
      number | string
    >;

    expect(row).toMatchObject({
      id: 1,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0,
      image_count: 0,
      lookup_count: 0,
    });
    expect(row.created_at_s).toBeGreaterThanOrEqual(before);
    expect(row.created_at_s).toBeLessThanOrEqual(before + 5);
    d.close();
  });

  it("keeps fractions of a cent in the cost column", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);

    d.prepare(
      `INSERT INTO artist_investigation_run (guild_id, channel_id, invoked_by, model, status, cost_usd) VALUES ('g', 'c', 'u', 'm', 'ok', ?)`
    ).run(0.144321);
    const row = d.prepare(`SELECT cost_usd FROM artist_investigation_run`).get() as {
      cost_usd: number;
    };

    expect(row.cost_usd).toBeCloseTo(0.144321, 9);
    d.close();
  });

  it("keeps one cached answer per image, service and variant", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);

    const insert = d.prepare(
      `INSERT OR IGNORE INTO artist_provenance_cache (image_sha256, service, variant, result_json) VALUES (?, ?, ?, '[]')`
    );
    expect(insert.run("abc", "fluffle", "original").changes).toBe(1);
    expect(insert.run("abc", "fluffle", "original").changes).toBe(0);
    expect(insert.run("abc", "fluffle", "mirrored").changes).toBe(1);
    expect(insert.run("abc", "e621", "original").changes).toBe(1);
    expect(insert.run("def", "fluffle", "original").changes).toBe(1);
    d.close();
  });

  it("treats a cached answer with no variant as the original image", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);

    d.prepare(
      `INSERT INTO artist_provenance_cache (image_sha256, service, result_json) VALUES ('abc', 'fluffle', '[]')`
    ).run();
    const row = d.prepare(`SELECT variant, fetched_at_s FROM artist_provenance_cache`).get() as {
      variant: string;
      fetched_at_s: number;
    };

    expect(row.variant).toBe("original");
    expect(row.fetched_at_s).toBeGreaterThan(1_700_000_000);
    d.close();
  });

  it("is idempotent, keeps existing rows and stamps the version once", () => {
    const d = freshDb();
    migrate084ArtistInvestigation(d);
    d.prepare(
      `INSERT INTO artist_investigation_run (guild_id, channel_id, invoked_by, model, status, cost_usd) VALUES ('g', 'c', 'u', 'm', 'ok', 1.5)`
    ).run();

    expect(() => migrate084ArtistInvestigation(d)).not.toThrow();

    const total = d
      .prepare(`SELECT COUNT(*) AS n, SUM(cost_usd) AS usd FROM artist_investigation_run`)
      .get();
    expect(total).toEqual({ n: 1, usd: 1.5 });
    const stamps = d
      .prepare(`SELECT version, name FROM schema_migrations WHERE version = '084'`)
      .all();
    expect(stamps).toEqual([{ version: "084", name: "artist_investigation" }]);
    d.close();
  });

  it("post-condition passes after the migration and fails before it or with a table missing", () => {
    const d = freshDb();
    expect(verify084ArtistInvestigation(d)).toBe(false);

    migrate084ArtistInvestigation(d);
    expect(verify084ArtistInvestigation(d)).toBe(true);

    d.exec(`DROP TABLE artist_provenance_cache`);
    expect(verify084ArtistInvestigation(d)).toBe(false);
    d.close();
  });

  it("matches the hand-written copy in the test fixture schema", () => {
    const migrated = freshDb();
    migrate084ArtistInvestigation(migrated);
    const fixture = fixtureDb();

    for (const table of TABLES) {
      expect(columns(fixture, table), `fixture differs for ${table}`).toEqual(
        columns(migrated, table)
      );
    }
    const indexSql = (d: Db) =>
      (
        d
          .prepare(
            `SELECT sql FROM sqlite_master WHERE type='index' AND name = 'idx_artist_investigation_run_created'`
          )
          .get() as { sql: string } | undefined
      )?.sql
        .replace(/\s+/g, " ")
        .trim();
    expect(indexSql(fixture)).toBe(indexSql(migrated));
    expect(indexSql(fixture)).toContain("artist_investigation_run(created_at_s)");
    migrated.close();
    fixture.close();
  });
});
