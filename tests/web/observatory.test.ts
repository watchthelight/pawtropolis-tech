// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/observatory.test.ts
 * WHAT: Unit tests for the public Observatory query module (read-only shaping of
 *       the precomputed rollup tables).
 * WHY: Pins the KPI math (net30d, messages7d, WoW, approval rate, decision p50
 *       median), the top-5 + "other" channel fold, the 7x24 heatmap grid fill,
 *       cohort retention percentages, and that moderator_id is NEVER exposed.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
}));
vi.mock("$lib/server/db", () => ({ db: () => dbRef.current! }));

const { makeDb } = await import("./_helpers/db.js");
const { getObservatoryData } = await import("../../web/src/lib/server/queries/observatory.js");

const DAY = 86400;
const G = "g1";
const TODAY_S = Math.floor(Date.UTC(2026, 4, 28) / 1000);
const dayStr = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

function seed(db: import("better-sqlite3").Database) {
  const dm = db.prepare(
    `INSERT INTO daily_metrics
       (guild_id, day, member_count, member_count_delta, joins, leaves, cumulative_net,
        message_count, active_authors, voice_minutes, dec_approve, dec_reject, dec_kick,
        apps_submitted, apps_approved, refreshed_at_s)
     VALUES (@guild_id, @day, @member_count, @member_count_delta, @joins, @leaves, @cumulative_net,
        @message_count, @active_authors, @voice_minutes, @dec_approve, @dec_reject, @dec_kick,
        @apps_submitted, @apps_approved, @refreshed_at_s)`
  );
  for (let i = 13; i >= 0; i--) {
    const s = TODAY_S - i * DAY;
    dm.run({
      guild_id: G,
      day: dayStr(s),
      member_count: 1000 + (13 - i),
      member_count_delta: 1,
      joins: 3,
      leaves: 1,
      cumulative_net: 100 + (13 - i) * 2,
      message_count: i <= 6 ? 110 : 100, // last7 vs prev7 => +10% WoW
      active_authors: i === 0 ? 50 : 40,
      voice_minutes: 60,
      dec_approve: 8,
      dec_reject: 2,
      dec_kick: 0,
      apps_submitted: 5,
      apps_approved: 4,
      refreshed_at_s: TODAY_S,
    });
  }

  const heat = db.prepare(
    `INSERT INTO activity_heatmap (guild_id, dow, hour, msg_count) VALUES (?, ?, ?, ?)`
  );
  heat.run(G, 2, 15, 42); // Wed 15:00
  heat.run(G, 5, 3, 7);

  const ten = db.prepare(
    `INSERT INTO tenure_buckets (guild_id, bucket, member_count, sort_order) VALUES (?, ?, ?, ?)`
  );
  ["<1w", "1-2w", "2-4w", "1-3m", "3-6m", "6-12m", "1y+"].forEach((b, i) => ten.run(G, b, (i + 1) * 2, i));

  const ch = db.prepare(
    `INSERT INTO channel_daily (guild_id, day, channel_id, channel_name, msg_count) VALUES (?, ?, ?, ?, ?)`
  );
  [
    ["c1", "general", 70],
    ["c2", "art", 60],
    ["c3", "intros", 50],
    ["c4", "games", 40],
    ["c5", "music", 30],
    ["c6", "spam", 20],
    ["c7", "bots", 10],
  ].forEach(([id, name, n]) => ch.run(G, "2026-05-28", id as string, name as string, n as number));

  const co = db.prepare(
    `INSERT INTO cohort_retention (guild_id, cohort_week, week_offset, cohort_size, retained) VALUES (?, ?, ?, ?, ?)`
  );
  co.run(G, "2026-03-02", 1, 10, 8); // 80%
  co.run(G, "2026-03-02", 2, 10, 5); // 50%

  db.prepare(
    `INSERT INTO event_daily (guild_id, event_date, event_type, qualified_count, total_count) VALUES (?, ?, ?, ?, ?)`
  ).run(G, "2026-05-25", "movie", 12, 20);

  db.prepare(
    `INSERT INTO qotd_weekly (guild_id, week, submitted, approved, used) VALUES (?, ?, ?, ?, ?)`
  ).run(G, "2026-05-18", 9, 6, 4);

  const re = db.prepare(`INSERT INTO reaction_emoji (guild_id, emoji, count) VALUES (?, ?, ?)`);
  re.run(G, ":paw:", 5);
  re.run(G, ":star:", 3);

  const ml = db.prepare(
    `INSERT INTO mod_leaderboard (guild_id, moderator_id, display_label, accepts, rejects, kicks, p50_s, p95_s, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  ml.run(G, "modX", "Mod A", 10, 2, 1, 240, 1860, 0);
  ml.run(G, "modY", "Mod B", 5, 4, 0, 600, 3600, 1);

  db.prepare(`INSERT INTO rollup_meta (guild_id, refreshed_at_s) VALUES (?, ?)`).run(G, TODAY_S);
}

beforeEach(() => {
  dbRef.current?.close();
  dbRef.current = makeDb();
  seed(dbRef.current);
});
afterAll(() => dbRef.current?.close());

describe("getObservatoryData", () => {
  it("computes the KPI band from the daily rollup", () => {
    const data = getObservatoryData(G);
    expect(data.currentMembers).toBe(1013);
    expect(data.kpis.net30d).toBe(28); // 14 days * (3-1)
    expect(data.kpis.messages7d).toBe(770); // 7 * 110
    expect(data.kpis.messagesWoWPct).toBe(10); // (770-700)/700
    expect(data.kpis.dauLatest).toBe(50);
    expect(data.kpis.approvalRatePct).toBe(80); // 112 / 140
  });

  it("folds channels beyond the top 5 into 'other'", () => {
    const { topChannels } = getObservatoryData(G);
    expect(topChannels).toHaveLength(6);
    expect(topChannels[0]).toEqual({ name: "general", count: 70 });
    expect(topChannels[5]).toEqual({ name: "other", count: 30 }); // 20 + 10
  });

  it("fills a 7x24 heatmap grid and tracks the max", () => {
    const { heatmap, heatmapMax } = getObservatoryData(G);
    expect(heatmap).toHaveLength(7);
    expect(heatmap[0]).toHaveLength(24);
    expect(heatmap[2][15]).toBe(42);
    expect(heatmap[5][3]).toBe(7);
    expect(heatmapMax).toBe(42);
  });

  it("computes cohort retention percentages", () => {
    const { cohorts } = getObservatoryData(G);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].offsets).toEqual([
      { offset: 1, retainedPct: 80 },
      { offset: 2, retainedPct: 50 },
    ]);
  });

  it("returns anonymized mods and the median decision p50, never moderator_id", () => {
    const { mods, kpis } = getObservatoryData(G);
    expect(mods).toHaveLength(2);
    expect(mods[0].label).toBe("Mod A");
    expect(mods[0]).not.toHaveProperty("moderator_id");
    expect(kpis.decisionP50S).toBe(420); // median(240, 600)
  });

  it("passes through events, qotd, and reactions", () => {
    const data = getObservatoryData(G);
    expect(data.events).toEqual([{ date: "2026-05-25", type: "movie", qualified: 12, total: 20 }]);
    expect(data.qotd).toEqual([{ week: "2026-05-18", submitted: 9, approved: 6, used: 4 }]);
    expect(data.reactions[0]).toEqual({ emoji: ":paw:", count: 5 });
    expect(data.refreshedAtS).toBe(TODAY_S);
    expect(data.hasData).toBe(true);
  });

  it("returns empty-but-valid data for a guild with no rollups", () => {
    const data = getObservatoryData("nope");
    expect(data.hasData).toBe(false);
    expect(data.currentMembers).toBeNull();
    expect(data.heatmap).toHaveLength(7);
    expect(data.topChannels).toEqual([]);
    expect(data.kpis.messagesWoWPct).toBeNull();
  });
});
