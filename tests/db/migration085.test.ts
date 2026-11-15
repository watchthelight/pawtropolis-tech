// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/db/migration085.test.ts
 * WHAT: Verifies migration 085 drops the two unused indexes on messages_archive
 *       and nothing else, is safe to run twice, and matches the test fixture schema.
 * WHY: Every read of the archive filters by guild and goes through
 *      idx_msgarc_guild_time, and the bot's upsert and its mark-deleted update
 *      go through the primary key. Dropping one of those by mistake would turn
 *      them into scans of three million rows. The fixture is written by hand,
 *      so it is compared with the migrations here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { migrate075MessageArchive } from "../../migrations/075_message_archive.js";
import {
  migrate085DropUnusedMsgarcIndexes,
  verify085DropUnusedMsgarcIndexes,
} from "../../migrations/085_drop_unused_msgarc_indexes.js";

type Db = InstanceType<typeof Database>;

function freshDb(): Db {
  const d = new Database(":memory:");
  d.exec(
    `CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`
  );
  return d;
}

/** A database as migration 075 leaves it: the archive tables with all their indexes. */
function archiveDb(): Db {
  const d = freshDb();
  migrate075MessageArchive(d);
  return d;
}

function fixtureDb(): Db {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = OFF");
  d.exec(readFileSync(path.join("tests", "fixtures", "schema.sql"), "utf8"));
  return d;
}

const allIndexes = (d: Db) =>
  (
    d.prepare(`SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`).all() as {
      name: string;
    }[]
  ).map((row) => row.name);

const archiveIndexes = (d: Db) =>
  (
    d
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = 'messages_archive' ORDER BY name`
      )
      .all() as { name: string; sql: string | null }[]
  ).map(({ name, sql }) => ({ name, sql: sql?.replace(/\s+/g, " ").trim() ?? null }));

const plan = (d: Db, sql: string) =>
  (d.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
    .map((step) => step.detail)
    .join(" / ");

const DROPPED = ["idx_msgarc_author_time", "idx_msgarc_channel_time"];
const KEPT = ["idx_msgarc_guild_time", "sqlite_autoindex_messages_archive_1"];

describe("migration 085: drop unused message archive indexes", () => {
  it("drops the author and the channel index and no other index in the database", () => {
    const d = archiveDb();
    const before = allIndexes(d);
    expect(before).toEqual(expect.arrayContaining([...DROPPED, ...KEPT]));

    migrate085DropUnusedMsgarcIndexes(d);

    const after = allIndexes(d);
    expect(before.filter((name) => !after.includes(name))).toEqual(DROPPED);
    expect(after.filter((name) => !before.includes(name))).toEqual([]);
    expect(archiveIndexes(d).map((index) => index.name)).toEqual(KEPT);
    d.close();
  });

  it("leaves every row as it was", () => {
    const d = archiveDb();
    const insert = d.prepare(
      `INSERT INTO messages_archive (message_id, guild_id, channel_id, author_id, author_name, content, created_at_s, ingested_at_s)
       VALUES (?, 'g', ?, ?, 'someone', ?, ?, 1700000000)`
    );
    insert.run("1", "c1", "a1", "first", 100);
    insert.run("2", "c2", "a1", "second", 200);
    insert.run("3", "c1", "a2", "third", 300);
    const rows = () => d.prepare(`SELECT * FROM messages_archive ORDER BY message_id`).all();
    const before = rows();

    migrate085DropUnusedMsgarcIndexes(d);

    expect(rows()).toEqual(before);
    expect(before).toHaveLength(3);
    d.close();
  });

  it("keeps the two ways the archive is reached: by guild and by message id", () => {
    const d = archiveDb();
    migrate085DropUnusedMsgarcIndexes(d);

    expect(plan(d, `SELECT COUNT(*) FROM messages_archive WHERE guild_id = 'g'`)).toContain(
      "idx_msgarc_guild_time"
    );
    expect(
      plan(d, `UPDATE messages_archive SET is_deleted = 1, deleted_at_s = 1 WHERE message_id = '1'`)
    ).toContain("sqlite_autoindex_messages_archive_1");
    d.close();
  });

  it("is safe to run twice and stamps the version once", () => {
    const d = archiveDb();
    migrate085DropUnusedMsgarcIndexes(d);

    expect(() => migrate085DropUnusedMsgarcIndexes(d)).not.toThrow();

    expect(archiveIndexes(d).map((index) => index.name)).toEqual(KEPT);
    const stamps = d
      .prepare(`SELECT version, name FROM schema_migrations WHERE version = '085'`)
      .all();
    expect(stamps).toEqual([{ version: "085", name: "drop_unused_msgarc_indexes" }]);
    d.close();
  });

  it("runs on a database that has no archive at all", () => {
    const d = freshDb();

    expect(() => migrate085DropUnusedMsgarcIndexes(d)).not.toThrow();

    expect(allIndexes(d).filter((name) => name.startsWith("idx_msgarc"))).toEqual([]);
    expect(verify085DropUnusedMsgarcIndexes(d)).toBe(true);
    d.close();
  });

  it("post-condition fails while a dropped index is there or the guild index is not", () => {
    const d = archiveDb();
    expect(verify085DropUnusedMsgarcIndexes(d)).toBe(false);

    migrate085DropUnusedMsgarcIndexes(d);
    expect(verify085DropUnusedMsgarcIndexes(d)).toBe(true);

    d.exec(`CREATE INDEX idx_msgarc_author_time ON messages_archive(author_id, created_at_s)`);
    expect(verify085DropUnusedMsgarcIndexes(d)).toBe(false);

    d.exec(`DROP INDEX idx_msgarc_author_time; DROP INDEX idx_msgarc_guild_time`);
    expect(verify085DropUnusedMsgarcIndexes(d)).toBe(false);
    d.close();
  });

  it("matches the hand-written copy in the test fixture schema", () => {
    const migrated = archiveDb();
    migrate085DropUnusedMsgarcIndexes(migrated);
    const fixture = fixtureDb();

    expect(archiveIndexes(fixture)).toEqual(archiveIndexes(migrated));
    expect(archiveIndexes(fixture).map((index) => index.sql)).toEqual([
      "CREATE INDEX idx_msgarc_guild_time ON messages_archive(guild_id, created_at_s)",
      null,
    ]);
    migrated.close();
    fixture.close();
  });
});
