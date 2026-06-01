// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/statsObservatory/refresh.test.ts
 * WHAT: Integration test for refreshPublicStats: seeds raw bot tables, runs the
 *       refresh, and asserts the rollup tables are computed correctly.
 * WHY: This is where the aggregation correctness rules from the Phase 0 brief
 *       are pinned: action_log terminal verbs only (perm_reject folded, claim
 *       excluded), the 6h voice restart cap, monday-based heatmap dow, reaction
 *       guild-scoping via messages_archive, and anonymized mod labels.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { refreshPublicStats, utcDay, mondayStartS } from "../../../src/features/statsObservatory/refresh.js";

const DAY = 86400;
const G = "g1";
const NOW_S = Math.floor(Date.UTC(2026, 4, 28, 12, 0, 0) / 1000); // 2026-05-28 12:00 UTC
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  Math.floor(Date.UTC(y, m, d, h, min) / 1000);

let db: Database.Database;

function expectedDow(s: number): number {
  return (new Date(s * 1000).getUTCDay() + 6) % 7;
}

beforeEach(() => {
  const schema = readFileSync(path.resolve(process.cwd(), "tests/fixtures/schema.sql"), "utf8");
  db = new Database(":memory:");
  db.pragma("foreign_keys = OFF"); // seeding FK-constrained tables without parents
  db.exec(schema);
});

function seed() {
  // --- snapshots: exact member_count per day ---
  db.prepare(`INSERT INTO guild_snapshot_log (guild_id, date, member_count) VALUES (?, ?, ?)`).run(
    G,
    "2026-05-27",
    1000
  );
  db.prepare(`INSERT INTO guild_snapshot_log (guild_id, date, member_count) VALUES (?, ?, ?)`).run(
    G,
    "2026-05-28",
    1005
  );

  // --- members: tenure reads user_activity (current-state); churn reads action_log ---
  const ua = db.prepare(
    `INSERT INTO user_activity (guild_id, user_id, joined_at, first_message_at, left_at) VALUES (?, ?, ?, ?, ?)`
  );
  // joined before window -> baseline only; still present (tenure 6-12m)
  ua.run(G, "old1", at(2025, 10, 1), at(2025, 10, 2), null);
  // joined yesterday, present (tenure <1w), one of today's joins
  ua.run(G, "u_new", at(2026, 4, 27, 8), at(2026, 4, 27, 9), null);
  // joined yesterday and left yesterday -> a leave
  ua.run(G, "u_left", at(2026, 4, 27, 6), null, at(2026, 4, 27, 20));
  // cohort member joined ~14 weeks ago, still present
  ua.run(G, "u_cohort", NOW_S - 14 * 7 * DAY + 3 * DAY, null, null);

  // append-only churn events in action_log (joins/leaves/cumulative_net + cohort
  // now derive from these, NOT from the mutable user_activity table above).
  const mem = db.prepare(
    `INSERT INTO action_log (guild_id, actor_id, action, created_at_s) VALUES (?, ?, ?, ?)`
  );
  // pre-window baseline joins (old1 + u_cohort), no pre-window leaves -> +2
  mem.run(G, "old1", "member_join", at(2025, 10, 1));
  mem.run(G, "u_cohort", "member_join", NOW_S - 14 * 7 * DAY + 3 * DAY);
  // within-window: u_new + u_left join yesterday (2 joins), u_left leaves yesterday (1 leave)
  mem.run(G, "u_new", "member_join", at(2026, 4, 27, 8));
  mem.run(G, "u_left", "member_join", at(2026, 4, 27, 6));
  mem.run(G, "u_left", "member_leave", at(2026, 4, 27, 20));

  // --- messages: volume / DAU / heatmap / channels ---
  const ma = db.prepare(
    `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket) VALUES (?, ?, ?, ?, ?)`
  );
  const m1 = at(2026, 4, 28, 3); // today 03:00 UTC
  const m2 = at(2026, 4, 28, 3, 30); // same hour, different author
  const m3 = at(2026, 4, 27, 15); // yesterday 15:00
  ma.run(G, "c1", "u_new", m1, Math.floor(m1 / 3600) * 3600);
  ma.run(G, "c1", "u_cohort", m2, Math.floor(m2 / 3600) * 3600);
  ma.run(G, "c2", "u_new", m3, Math.floor(m3 / 3600) * 3600);

  // --- voice: 6h cap on a dangling (restart-spanning) session ---
  const vs = db.prepare(
    `INSERT INTO voice_session (guild_id, user_id, channel_id, joined_at_s, left_at_s) VALUES (?, ?, ?, ?, ?)`
  );
  vs.run(G, "u_new", "v1", at(2026, 4, 27, 10), null); // dangling -> capped to 6h = 360 min
  vs.run(G, "u_cohort", "v1", at(2026, 4, 27, 9), at(2026, 4, 27, 9, 30)); // 30 min

  // --- decisions: action_log terminal verbs; claim must be excluded ---
  const al = db.prepare(
    `INSERT INTO action_log (guild_id, actor_id, action, created_at_s) VALUES (?, ?, ?, ?)`
  );
  const today = at(2026, 4, 28, 4);
  al.run(G, "modX", "approve", today);
  al.run(G, "modX", "approve", today);
  al.run(G, "modY", "reject", today);
  al.run(G, "modY", "perm_reject", today); // folds into reject
  al.run(G, "modX", "kick", today);
  al.run(G, "modX", "claim", today); // excluded

  // --- applications: TEXT timestamps ---
  const app = db.prepare(
    `INSERT INTO application (id, guild_id, user_id, status, submitted_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  app.run("a1", G, "u_new", "approved", "2026-05-28 04:00:00", "2026-05-28 05:00:00");
  app.run("a2", G, "u_left", "submitted", "2026-05-28 06:00:00", null);

  // --- events ---
  const mv = db.prepare(
    `INSERT INTO movie_attendance (guild_id, user_id, event_date, voice_channel_id, duration_minutes, longest_session_minutes, qualified, event_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  mv.run(G, "u_new", "2026-05-25", "vc", 120, 120, 1, "movie");
  mv.run(G, "u_cohort", "2026-05-25", "vc", 10, 10, 0, "movie");

  // --- qotd ---
  const q = db.prepare(
    `INSERT INTO qotd_suggestion (guild_id, user_id, question, status, short_code, created_at_s, reviewed_at_s, used_at_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  q.run(G, "u_new", "Q1", "used", "sc1", at(2026, 4, 20), at(2026, 4, 21), at(2026, 4, 22));
  q.run(G, "u_cohort", "Q2", "pending", "sc2", at(2026, 4, 26), null, null);

  // --- reactions: must be guild-scoped via messages_archive ---
  db.prepare(
    `INSERT INTO messages_archive (message_id, guild_id, channel_id, author_id, author_name, created_at_s) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("msg1", G, "c1", "u_new", "u_new", at(2026, 4, 26));
  const re = db.prepare(
    `INSERT INTO message_reactions_archive (message_id, emoji, user_id, reacted_at_s) VALUES (?, ?, ?, ?)`
  );
  re.run("msg1", ":paw:", "u1", at(2026, 4, 26, 1));
  re.run("msg1", ":paw:", "u2", at(2026, 4, 26, 2));
  re.run("msg1", ":star:", "u1", at(2026, 4, 26, 3));
  re.run("msgGHOST", ":skull:", "u1", at(2026, 4, 26, 4)); // no messages_archive parent -> excluded

  // --- channel names for denormalization ---
  db.prepare(
    `INSERT INTO channel_cache (guild_id, channel_id, name, type, updated_at_s) VALUES (?, ?, ?, ?, ?)`
  ).run(G, "c1", "general", 0, NOW_S);

  // --- mod metrics (already a rollup) ---
  const mm = db.prepare(
    `INSERT INTO mod_metrics (moderator_id, guild_id, total_accepts, total_rejects, total_kicks, p50_response_time_s, p95_response_time_s) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  mm.run("modX", G, 10, 2, 1, 240, 1860);
  mm.run("modY", G, 5, 4, 0, 600, 3600);
}

describe("refreshPublicStats", () => {
  it("runs on an empty database without throwing and writes a freshness marker", () => {
    const summary = refreshPublicStats(db, G, NOW_S);
    expect(summary.days).toBeGreaterThan(90);
    const meta = db.prepare(`SELECT refreshed_at_s FROM rollup_meta WHERE guild_id = ?`).get(G) as {
      refreshed_at_s: number;
    };
    expect(meta.refreshed_at_s).toBe(NOW_S);
  });

  it("computes daily_metrics correctly from seeded raw data", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);

    const today = db
      .prepare(`SELECT * FROM daily_metrics WHERE guild_id = ? AND day = ?`)
      .get(G, "2026-05-28") as Record<string, number>;
    const yest = db
      .prepare(`SELECT * FROM daily_metrics WHERE guild_id = ? AND day = ?`)
      .get(G, "2026-05-27") as Record<string, number>;

    // member_count exact + delta
    expect(today.member_count).toBe(1005);
    expect(today.member_count_delta).toBe(5);

    // joins/leaves landed on the right day
    expect(yest.joins).toBe(2); // u_new + u_left joined yesterday
    expect(yest.leaves).toBe(1); // u_left

    // messages + DAU
    expect(today.message_count).toBe(2);
    expect(today.active_authors).toBe(2);
    expect(yest.message_count).toBe(1);

    // voice: 6h cap (360) + 30 = 390 on yesterday's join day
    expect(yest.voice_minutes).toBe(390);

    // decisions: perm_reject folds into reject, claim excluded
    expect(today.dec_approve).toBe(2);
    expect(today.dec_reject).toBe(2);
    expect(today.dec_kick).toBe(1);

    // applications: both a1 and a2 were submitted on 2026-05-28; a1 also approved
    expect(today.apps_submitted).toBe(2);
    expect(today.apps_approved).toBe(1);
  });

  it("places message activity in the correct monday-based heatmap cell", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const m1 = at(2026, 4, 28, 3);
    const cell = db
      .prepare(`SELECT msg_count FROM activity_heatmap WHERE guild_id = ? AND dow = ? AND hour = ?`)
      .get(G, expectedDow(m1), 3) as { msg_count: number } | undefined;
    expect(cell?.msg_count).toBe(2); // m1 + m2 same hour
  });

  it("denormalizes channel names and aggregates per day", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const c1 = db
      .prepare(`SELECT channel_name, msg_count FROM channel_daily WHERE guild_id = ? AND channel_id = ? AND day = ?`)
      .get(G, "c1", "2026-05-28") as { channel_name: string; msg_count: number };
    expect(c1.channel_name).toBe("general");
    expect(c1.msg_count).toBe(2);
  });

  it("scopes reactions to the guild via messages_archive and excludes orphans", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const rows = db
      .prepare(`SELECT emoji, count FROM reaction_emoji WHERE guild_id = ? ORDER BY count DESC`)
      .all(G) as { emoji: string; count: number }[];
    expect(rows).toEqual([
      { emoji: ":paw:", count: 2 },
      { emoji: ":star:", count: 1 },
    ]);
  });

  it("anonymizes the moderator leaderboard in accepts-rank order", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const rows = db
      .prepare(`SELECT moderator_id, display_label, accepts, p50_s FROM mod_leaderboard WHERE guild_id = ? ORDER BY sort_order ASC`)
      .all(G) as { moderator_id: string; display_label: string; accepts: number; p50_s: number }[];
    expect(rows[0]).toMatchObject({ moderator_id: "modX", display_label: "Mod A", accepts: 10, p50_s: 240 });
    expect(rows[1]).toMatchObject({ moderator_id: "modY", display_label: "Mod B", accepts: 5 });
  });

  it("computes event participation counts", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const ev = db
      .prepare(`SELECT qualified_count, total_count FROM event_daily WHERE guild_id = ? AND event_date = ?`)
      .get(G, "2026-05-25") as { qualified_count: number; total_count: number };
    expect(ev).toEqual({ qualified_count: 1, total_count: 2 });
  });

  it("buckets the QOTD funnel by the timestamp of each stage", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const totalSubmitted = (
      db.prepare(`SELECT SUM(submitted) AS n FROM qotd_weekly WHERE guild_id = ?`).get(G) as { n: number }
    ).n;
    const totalUsed = (
      db.prepare(`SELECT SUM(used) AS n FROM qotd_weekly WHERE guild_id = ?`).get(G) as { n: number }
    ).n;
    expect(totalSubmitted).toBe(2);
    expect(totalUsed).toBe(1);
  });

  it("records a tenure histogram over current members", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const buckets = db
      .prepare(`SELECT bucket, member_count FROM tenure_buckets WHERE guild_id = ? ORDER BY sort_order`)
      .all(G) as { bucket: string; member_count: number }[];
    expect(buckets).toHaveLength(7);
    const byBucket = Object.fromEntries(buckets.map((b) => [b.bucket, b.member_count]));
    expect(byBucket["<1w"]).toBe(1); // u_new
    expect(byBucket["6-12m"]).toBe(1); // old1 (~239 days)
    // u_left is gone (left_at set) so excluded; u_cohort joined ~95 days ago -> 3-6m
    expect(byBucket["3-6m"]).toBe(1);
    expect(byBucket["1-3m"]).toBe(0);
  });

  it("anchors cumulative net growth to pre-window baseline", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    // baseline: old1 + u_cohort joined before window, no leaves before window -> +2.
    // within window: u_new join (+1), u_left join+leave (net 0). End cumulative = 3.
    const today = db
      .prepare(`SELECT cumulative_net FROM daily_metrics WHERE guild_id = ? AND day = ?`)
      .get(G, "2026-05-28") as { cumulative_net: number };
    expect(today.cumulative_net).toBe(3);
  });

  it("is idempotent: a second run yields identical rollups", () => {
    seed();
    refreshPublicStats(db, G, NOW_S);
    const first = db.prepare(`SELECT * FROM daily_metrics WHERE guild_id = ? ORDER BY day`).all(G);
    refreshPublicStats(db, G, NOW_S);
    const second = db.prepare(`SELECT * FROM daily_metrics WHERE guild_id = ? ORDER BY day`).all(G);
    expect(second).toEqual(first);
  });
});

describe("refreshPublicStats churn from append-only action_log (rejoin regression)", () => {
  // Core regression for #00145: user_activity is mutable current-state. A rejoin
  // upserts joined_at and clears left_at, erasing the prior leave and moving the
  // join day. Deriving churn from action_log member_join / member_leave events
  // (append-only) keeps historical metrics stable across rejoins.
  const U = "u_rejoin";
  // Week 1 join, week 2 leave, week 5 rejoin -- all inside the 95d / 16-week window.
  const wk1Join = at(2026, 3, 6, 10); // 2026-04-06 10:00 (a Monday)
  const wk2Leave = at(2026, 3, 13, 12); // 2026-04-13 12:00
  const wk5Rejoin = at(2026, 4, 4, 9); // 2026-05-04 09:00

  function seedRejoin() {
    const mem = db.prepare(
      `INSERT INTO action_log (guild_id, actor_id, action, created_at_s) VALUES (?, ?, ?, ?)`
    );
    mem.run(G, U, "member_join", wk1Join);
    mem.run(G, U, "member_leave", wk2Leave);
    mem.run(G, U, "member_join", wk5Rejoin);
    // user_activity reflects the LATEST rejoin only (mutable current-state). If
    // churn read this table, the week-2 leave and week-1 join day would be lost.
    db.prepare(
      `INSERT INTO user_activity (guild_id, user_id, joined_at, first_message_at, left_at) VALUES (?, ?, ?, ?, ?)`
    ).run(G, U, wk5Rejoin, null, null);
  }

  it("counts the week-2 leave even though the user later rejoined", () => {
    seedRejoin();
    refreshPublicStats(db, G, NOW_S);
    const leaveDay = db
      .prepare(`SELECT leaves FROM daily_metrics WHERE guild_id = ? AND day = ?`)
      .get(G, utcDay(wk2Leave)) as { leaves: number } | undefined;
    expect(leaveDay?.leaves).toBe(1);
  });

  it("reflects the leave in cumulative_net at the correct historical date", () => {
    seedRejoin();
    refreshPublicStats(db, G, NOW_S);
    // Day before the leave: only the week-1 join has happened -> net +1.
    const beforeLeave = db
      .prepare(`SELECT cumulative_net FROM daily_metrics WHERE guild_id = ? AND day = ?`)
      .get(G, utcDay(wk2Leave - DAY)) as { cumulative_net: number };
    // Leave day: +1 join - 1 leave -> net 0.
    const onLeave = db
      .prepare(`SELECT cumulative_net FROM daily_metrics WHERE guild_id = ? AND day = ?`)
      .get(G, utcDay(wk2Leave)) as { cumulative_net: number };
    // After the week-5 rejoin: +1 again -> net 1.
    const afterRejoin = db
      .prepare(`SELECT cumulative_net FROM daily_metrics WHERE guild_id = ? AND day = ?`)
      .get(G, utcDay(wk5Rejoin)) as { cumulative_net: number };
    expect(beforeLeave.cumulative_net).toBe(1);
    expect(onLeave.cumulative_net).toBe(0);
    expect(afterRejoin.cumulative_net).toBe(1);
  });

  it("buckets the user into the week-1 (first-join) cohort and counts them present after rejoin", () => {
    seedRejoin();
    refreshPublicStats(db, G, NOW_S);
    const cohortWeek = utcDay(mondayStartS(wk1Join));
    const rows = db
      .prepare(
        `SELECT cohort_week, cohort_size, retained FROM cohort_retention WHERE guild_id = ? AND cohort_week = ?`
      )
      .all(G, cohortWeek) as { cohort_week: string; cohort_size: number; retained: number }[];
    // The user's cohort is week 1 (first join), not week 5 (the rejoin).
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.cohort_size).toBe(1);
      // Latest membership event is the week-5 member_join -> still present.
      expect(r.retained).toBe(1);
    }
    // No cohort row is created for the rejoin week.
    const rejoinWeek = utcDay(mondayStartS(wk5Rejoin));
    const rejoinRows = db
      .prepare(`SELECT 1 FROM cohort_retention WHERE guild_id = ? AND cohort_week = ?`)
      .all(G, rejoinWeek);
    expect(rejoinRows.length).toBe(0);
  });
});
