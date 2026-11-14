// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/botDetectionAuthors.test.ts
 * WHAT: checkActivityLevel with a preloaded message-author set against a real SQLite schema.
 * WHY: /audit members preloads one set per run instead of querying message_activity per
 *      member. The result must match the per-member query for every kind of member.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
}));
vi.mock("../../src/db/db.js", () => ({
  db: { prepare: (sql: string) => dbRef.current!.prepare(sql) },
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { checkActivityLevel, loadMessageAuthors } =
  await import("../../src/features/botDetection.js");

const G = "g1";

beforeAll(() => {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = OFF");
  d.exec(readFileSync(path.resolve(process.cwd(), "tests/fixtures/schema.sql"), "utf8"));
  const ma = d.prepare(
    `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket) VALUES (?, ?, ?, ?, ?)`
  );
  ma.run(G, "c1", "talker", 1000, 0);
  ma.run(G, "c1", "talker", 2000, 0);
  ma.run(G, "c1", "other_guild_talker", 3000, 0);
  ma.run("g2", "c1", "other_guild_talker", 3000, 0);
  ma.run("g2", "c1", "g2_only", 3000, 0);
  d.prepare(
    `INSERT INTO user_activity (guild_id, user_id, joined_at, first_message_at, left_at) VALUES (?, ?, ?, ?, ?)`
  ).run(G, "tracked_only", 500, 900, null);
  dbRef.current = d;
});

afterAll(() => dbRef.current?.close());

describe("loadMessageAuthors", () => {
  it("returns distinct authors of the given guild only", () => {
    expect([...loadMessageAuthors(G)].sort()).toEqual(["other_guild_talker", "talker"]);
    expect([...loadMessageAuthors("g2")].sort()).toEqual(["g2_only", "other_guild_talker"]);
    expect(loadMessageAuthors("none").size).toBe(0);
  });
});

describe("checkActivityLevel with a preloaded author set", () => {
  it("matches the per-member query for authors, first-message-only users and strangers", () => {
    const authors = loadMessageAuthors(G);
    for (const user of ["talker", "tracked_only", "g2_only", "nobody"]) {
      expect(checkActivityLevel(G, user, authors)).toEqual(checkActivityLevel(G, user));
    }
    expect(checkActivityLevel(G, "talker", authors)).toEqual({
      hasActivity: true,
      firstMessageAt: null,
      messageCount: 1,
    });
    expect(checkActivityLevel(G, "tracked_only", authors).hasActivity).toBe(true);
    expect(checkActivityLevel(G, "g2_only", authors).hasActivity).toBe(false);
  });
});
