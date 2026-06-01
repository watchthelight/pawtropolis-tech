// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pulseChurn.test.ts
 * WHAT: Integration tests for the pulse churn detectors (leave-spike,
 *       rapid-join-leave) after rewiring them off the mutable user_activity
 *       table onto the append-only action_log member_join / member_leave events.
 * WHY: Regression for #00145. user_activity is current-state: a rejoin upserts
 *       joined_at and clears left_at, erasing the prior leave. Sourcing churn
 *       from action_log keeps historical leaves countable. These tests seed
 *       action_log and assert getInsights emits the leave-spike insight.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

import { makeDb } from "./_helpers/db.js";

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
}));
vi.mock("$lib/server/db", () => ({ db: () => dbRef.current! }));
// pulse.ts imports callBotApi from $lib/server/botApi for getLevelRoleStats;
// the churn detectors never touch it, but the module-level import must resolve.
vi.mock("$lib/server/botApi", () => ({ callBotApi: vi.fn() }));

const { getInsights } = await import("$lib/server/queries/pulse");

const DAY = 86400;
const G = "g1";
// Fixed "now" so the 7d window and the 4x baseline window are deterministic.
const NOW_S = Math.floor(Date.UTC(2026, 4, 28, 12, 0, 0) / 1000); // 2026-05-28 12:00 UTC
const range = (startS: number, endS: number) => ({
  startS,
  endS,
  prevStartS: startS - (endS - startS),
});

beforeEach(() => {
  dbRef.current?.close();
  dbRef.current = makeDb();
  dbRef.current.pragma("foreign_keys = OFF");
});
afterAll(() => dbRef.current?.close());

function leave(userId: string, ts: number) {
  dbRef
    .current!.prepare(
      `INSERT INTO action_log (guild_id, actor_id, action, created_at_s) VALUES (?, ?, ?, ?)`
    )
    .run(G, userId, "member_leave", ts);
}
function join(userId: string, ts: number) {
  dbRef
    .current!.prepare(
      `INSERT INTO action_log (guild_id, actor_id, action, created_at_s) VALUES (?, ?, ?, ?)`
    )
    .run(G, userId, "member_join", ts);
}

describe("pulse leave-spike detector (action_log member_leave)", () => {
  it("fires when this week's leaves are >= 2x the 4x-window baseline", () => {
    const winStart = NOW_S - 7 * DAY;
    // Baseline window is the 4 weeks before winStart. Seed 4 leaves there (avg = 1/wk).
    for (let i = 1; i <= 4; i++) leave(`base${i}`, winStart - i * 7 * DAY + DAY);
    // This week: 5 leaves -> 5x the baseline average -> spike.
    for (let i = 1; i <= 5; i++) leave(`now${i}`, winStart + i * 3600);

    const insights = getInsights(G, range(winStart, NOW_S));
    const spike = insights.find((x) => x.id === "leave-spike");
    expect(spike).toBeDefined();
    expect(spike?.metric).toBe("5");
  });

  it("counts a leave that a later rejoin would have erased in user_activity", () => {
    const winStart = NOW_S - 7 * DAY;
    // Baseline so the detector has a comparison point.
    for (let i = 1; i <= 4; i++) leave(`base${i}`, winStart - i * 7 * DAY + DAY);
    // Five users leave this week; one of them (u_rejoin) also rejoins afterwards.
    for (let i = 1; i <= 5; i++) leave(`now${i}`, winStart + i * 3600);
    // u_rejoin == now1 rejoins after leaving. user_activity would now show them
    // present with left_at NULL, erasing the leave -- but action_log keeps it.
    join("now1", NOW_S - 3600);
    // Mirror the mutable current-state row the bot would hold post-rejoin.
    dbRef
      .current!.prepare(
        `INSERT INTO user_activity (guild_id, user_id, joined_at, first_message_at, left_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(G, "now1", NOW_S - 3600, null, null);

    const insights = getInsights(G, range(winStart, NOW_S));
    const spike = insights.find((x) => x.id === "leave-spike");
    expect(spike).toBeDefined();
    // All 5 leaves still counted despite the rejoin.
    expect(spike?.metric).toBe("5");
  });

  it("does not fire when there is no prior-window baseline", () => {
    const winStart = NOW_S - 7 * DAY;
    // Leaves only this week, none in the baseline window.
    for (let i = 1; i <= 5; i++) leave(`now${i}`, winStart + i * 3600);
    const insights = getInsights(G, range(winStart, NOW_S));
    expect(insights.find((x) => x.id === "leave-spike")).toBeUndefined();
  });
});
