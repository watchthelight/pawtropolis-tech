// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pulseDaily.test.ts
 * WHAT: getPulseMetrics dailyDistribution against a seeded message_activity table.
 * WHY: The day bucket divided by a bound JS number, which better-sqlite3 binds as
 *      REAL, so every distinct second became its own group and each day reported 1.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

import { makeDb } from "./_helpers/db.js";

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
}));
vi.mock("$lib/server/db", () => ({ db: () => dbRef.current! }));
vi.mock("$lib/server/botApi", () => ({ callBotApi: vi.fn() }));

const { getPulseMetrics } = await import("$lib/server/queries/pulse");

const DAY = 86400;
const G = "g1";
const START_S = Math.floor(Date.UTC(2026, 4, 25, 0, 0, 0) / 1000);

beforeEach(() => {
  dbRef.current?.close();
  dbRef.current = makeDb();
  dbRef.current.pragma("foreign_keys = OFF");
});
afterAll(() => dbRef.current?.close());

function msg(user: string, s: number) {
  dbRef
    .current!.prepare(
      `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket) VALUES (?, ?, ?, ?, ?)`
    )
    .run(G, "c1", user, s, s - (s % 3600));
}

describe("getPulseMetrics dailyDistribution", () => {
  it("sums every message of a day into one integer bucket", () => {
    const secs = [
      [17, 3, 41],
      [1, 22, 9],
      [11, 11, 11],
      [5, 59, 59],
      [23, 59, 59],
    ];
    const perDay = [3, 2, 5];
    let k = 0;
    perDay.forEach((n, d) => {
      for (let i = 0; i < n; i++) {
        const [h, m, s] = secs[k % secs.length]!;
        k++;
        msg(`u${k}`, START_S + d * DAY + h! * 3600 + m! * 60 + s! + (i >= secs.length ? 1 : 0));
      }
    });
    const m = getPulseMetrics(G, {
      startS: START_S,
      endS: START_S + 3 * DAY,
      prevStartS: START_S - 3 * DAY,
    });
    expect(m.windowDays).toBe(3);
    expect(m.dailyDistribution).toEqual([3, 2, 5]);
    expect(m.dailyDistribution.reduce((a, b) => a + b, 0)).toBe(m.messagesInWindow);
  });

  it("buckets a window that does not start at midnight by offset from the window start", () => {
    const start = START_S + 7 * 3600 + 13;
    msg("a", start);
    msg("b", start + DAY - 1);
    msg("c", start + DAY);
    const m = getPulseMetrics(G, { startS: start, endS: start + 2 * DAY, prevStartS: start - 2 * DAY });
    expect(m.dailyDistribution).toEqual([2, 1]);
  });
});
