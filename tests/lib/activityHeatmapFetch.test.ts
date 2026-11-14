// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/lib/activityHeatmapFetch.test.ts
 * WHAT: Characterization of fetchActivityData against a real SQLite schema.
 * WHY: The hour bucketing moved from JS over raw rows to a SQL GROUP BY. The output
 *      must stay identical across timezones, DST shifts, week boundaries and
 *      messages that sit exactly on a window edge. The expected digest was
 *      recorded from the raw-rows implementation before the query changed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
}));
vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: (sql: string) => dbRef.current!.prepare(sql),
  },
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { fetchActivityData } = await import("../../src/lib/activityHeatmap.js");

const G = "g1";
const NOW = Date.UTC(2026, 2, 11, 17, 42, 13);
const NOW_S = Math.floor(NOW / 1000);
const WEEK = 7 * 86400;
const ZONES = ["UTC", "America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata"];

function seedRows(): number[] {
  const out: number[] = [];
  let x = 123456789;
  const rnd = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
  for (let i = 0; i < 4000; i++) {
    out.push(NOW_S - 9 * WEEK + Math.floor(rnd() * 9 * WEEK));
  }
  for (let k = 0; k <= 8; k++) {
    const edge = NOW_S - k * WEEK;
    out.push(edge, edge - 1, edge + 1, edge - WEEK, edge - WEEK + 1, edge - WEEK - 1);
  }
  const hourEdge = NOW_S - (NOW_S % 3600) - 3 * 86400;
  out.push(hourEdge, hourEdge - 1, hourEdge + 3599, hourEdge + 3600);
  const monday = Math.floor(Date.UTC(2026, 2, 9, 0, 0, 0) / 1000);
  out.push(monday, monday - 1, monday + 86400 * 7 - 1, monday + 86400 * 7);
  return out;
}

let originalTz: string | undefined;

beforeAll(() => {
  originalTz = process.env.TZ;
  const schema = readFileSync(path.resolve(process.cwd(), "tests/fixtures/schema.sql"), "utf8");
  const d = new Database(":memory:");
  d.pragma("foreign_keys = OFF");
  d.exec(schema);
  const ins = d.prepare(
    `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket) VALUES (?, ?, ?, ?, ?)`
  );
  seedRows().forEach((s, i) => {
    ins.run(G, "c1", `u${i % 37}`, s, s - (s % 3600));
    if (i % 11 === 0) ins.run("other", "c1", "ux", s, s - (s % 3600));
  });
  dbRef.current = d;
});

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  dbRef.current?.close();
  vi.useRealTimers();
});

function digest(): string {
  const h = createHash("sha256");
  for (const tz of ZONES) {
    process.env.TZ = tz;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    for (let weeks = 1; weeks <= 8; weeks++) {
      h.update(JSON.stringify(fetchActivityData(G, weeks)));
    }
    vi.useRealTimers();
  }
  return h.digest("hex");
}

describe("fetchActivityData characterization", () => {
  it("produces the recorded output across timezones, DST and window edges", () => {
    expect(digest()).toBe("ddd65bb0cedcf19b81fe2fec43ad08e03b838e6a11d7f67959731263096ca086");
  });

  it("really switches timezone between runs", () => {
    const starts = new Set<string>();
    for (const tz of ZONES) {
      process.env.TZ = tz;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      starts.add(JSON.stringify(fetchActivityData(G, 1).weeks[0]!.dates));
      vi.useRealTimers();
    }
    expect(starts.size).toBeGreaterThan(1);
  });

  it("puts a message exactly on an hour edge in the hour it belongs to", () => {
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const d = fetchActivityData(G, 1);
    const total = d.weeks[0]!.grid.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(d.trends.totalMessages);
    vi.useRealTimers();
  });

  it("returns the hourly counts for a single week", () => {
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const d = fetchActivityData(G, 1);
    const direct = dbRef
      .current!.prepare(
        `SELECT created_at_s FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s <= ?`
      )
      .all(G, NOW_S - WEEK, NOW_S) as { created_at_s: number }[];
    expect(d.trends.totalMessages).toBe(direct.length);
    vi.useRealTimers();
  });
});
