/**
 * Pawtropolis Tech -- src/features/statsObservatory/refresh.ts
 * WHAT: Recomputes the public Stats Observatory rollup tables (migration 078)
 *       from the raw bot tables, for a single guild.
 * WHY: The public /observatory page must read ONLY these small precomputed
 *       tables so request-time render is sub-millisecond and trivially cacheable.
 *       All heavy GROUP BY aggregation happens here, out of band.
 * HOW: One transaction. Each rollup is fully overwritten for the guild. The
 *       function takes a db handle and a fixed nowS so it is deterministic and
 *       unit-testable against an in-memory schema.
 *
 * Correctness rules (verified against the live schema in the Phase 0 brief):
 *  - Decisions come from action_log terminal verbs only (approve, reject,
 *    perm_reject folded into reject, kick). NEVER union review_action: the bot
 *    dual-writes and a union double-counts.
 *  - Voice minutes cap any single session at 6h so sessions spanning a bot
 *    restart (left_at_s swept to "now" on shutdown) cannot inflate a day.
 *  - Response p50/p95 come from the precomputed mod_metrics table.
 *  - Reactions live in message_reactions_archive which has NO guild_id, so we
 *    join messages_archive by message_id to scope to the guild.
 *  - Timestamps are mixed: user_activity / message_activity / voice_session /
 *    action_log / qotd_suggestion are INTEGER unix seconds; application and
 *    guild_snapshot_log.date are TEXT.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";

const DAY_S = 86400;
const WINDOW_DAYS = 95; // covers the 90d message_activity horizon plus slack
const HEATMAP_WINDOW_DAYS = 84; // 12 weeks
const COHORT_LOOKBACK_WEEKS = 16;
const COHORT_OFFSETS = [1, 2, 4, 8, 12] as const;
const QOTD_LOOKBACK_WEEKS = 16;
const VOICE_SESSION_CAP_S = 6 * 3600; // restart guard
const REACTION_TOP_N = 50;
const MOD_TOP_N = 12;

const TENURE_BUCKETS: { bucket: string; maxS: number | null }[] = [
  { bucket: "<1w", maxS: 7 * DAY_S },
  { bucket: "1-2w", maxS: 14 * DAY_S },
  { bucket: "2-4w", maxS: 28 * DAY_S },
  { bucket: "1-3m", maxS: 90 * DAY_S },
  { bucket: "3-6m", maxS: 180 * DAY_S },
  { bucket: "6-12m", maxS: 365 * DAY_S },
  { bucket: "1y+", maxS: null },
];

export interface RefreshSummary {
  guildId: string;
  refreshedAtS: number;
  days: number;
  heatmapCells: number;
  cohortRows: number;
  channels: number;
  events: number;
  qotdWeeks: number;
  reactions: number;
  mods: number;
}

/** Format a unix-seconds instant as a UTC 'YYYY-MM-DD' day string. */
export function utcDay(s: number): string {
  return new Date(s * 1000).toISOString().slice(0, 10);
}

/** UTC midnight (unix seconds) of the day containing s. */
function utcMidnightS(s: number): number {
  return Math.floor(s / DAY_S) * DAY_S;
}

/** Monday 00:00 UTC (unix seconds) of the ISO week containing s. */
export function mondayStartS(s: number): number {
  const dow = new Date(s * 1000).getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = (dow + 6) % 7; // days since Monday
  return utcMidnightS(s) - mondayOffset * DAY_S;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));

/**
 * Recompute every Stats Observatory rollup for one guild. Idempotent: each
 * rollup is overwritten. Safe on empty source tables (writes zero rows).
 */
export function refreshPublicStats(db: Database, guildId: string, nowS: number): RefreshSummary {
  const windowStartS = utcMidnightS(nowS) - (WINDOW_DAYS - 1) * DAY_S;
  const windowStartISO = new Date(windowStartS * 1000).toISOString().slice(0, 19).replace("T", " ");

  const run = db.transaction((): RefreshSummary => {
    const days = rebuildDailyMetrics(db, guildId, nowS, windowStartS, windowStartISO);
    const heatmapCells = rebuildHeatmap(db, guildId, nowS);
    const cohortRows = rebuildCohortRetention(db, guildId, nowS);
    rebuildTenure(db, guildId, nowS);
    const channels = rebuildChannelDaily(db, guildId, windowStartS);
    const events = rebuildEventDaily(db, guildId);
    const qotdWeeks = rebuildQotdWeekly(db, guildId, nowS);
    const reactions = rebuildReactions(db, guildId, nowS);
    const mods = rebuildModLeaderboard(db, guildId);

    db.prepare(
      `INSERT INTO rollup_meta (guild_id, refreshed_at_s) VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET refreshed_at_s = excluded.refreshed_at_s`
    ).run(guildId, nowS);

    return {
      guildId,
      refreshedAtS: nowS,
      days,
      heatmapCells,
      cohortRows,
      channels,
      events,
      qotdWeeks,
      reactions,
      mods,
    };
  });

  return run();
}

interface DayAcc {
  member_count: number | null;
  joins: number;
  leaves: number;
  message_count: number;
  active_authors: number;
  voice_minutes: number;
  dec_approve: number;
  dec_reject: number;
  dec_kick: number;
  apps_submitted: number;
  apps_approved: number;
}

function rebuildDailyMetrics(
  db: Database,
  guildId: string,
  nowS: number,
  windowStartS: number,
  windowStartISO: string
): number {
  const todayMidnight = utcMidnightS(nowS);
  const dayList: string[] = [];
  const acc = new Map<string, DayAcc>();
  for (let t = windowStartS; t <= todayMidnight; t += DAY_S) {
    const day = utcDay(t);
    dayList.push(day);
    acc.set(day, {
      member_count: null,
      joins: 0,
      leaves: 0,
      message_count: 0,
      active_authors: 0,
      voice_minutes: 0,
      dec_approve: 0,
      dec_reject: 0,
      dec_kick: 0,
      apps_submitted: 0,
      apps_approved: 0,
    });
  }
  const touch = (day: string): DayAcc | undefined => acc.get(day);

  // member_count from the daily snapshot log (exact, one row per day)
  for (const r of db
    .prepare(`SELECT date AS day, member_count FROM guild_snapshot_log WHERE guild_id = ? AND date >= ?`)
    .all(guildId, utcDay(windowStartS)) as Row[]) {
    const a = touch(String(r.day));
    if (a) a.member_count = r.member_count == null ? null : num(r.member_count);
  }

  // joins / leaves from action_log append-only events (created_at_s is INTEGER
  // seconds). user_activity is mutable current-state: a rejoin erases the prior
  // leave and moves the join day, so historical churn would change retroactively.
  // action_log records one immutable row per member_join / member_leave.
  for (const r of db
    .prepare(
      `SELECT date(created_at_s, 'unixepoch') AS day, COUNT(*) AS n
       FROM action_log WHERE guild_id = ? AND action = 'member_join' AND created_at_s >= ? GROUP BY day`
    )
    .all(guildId, windowStartS) as Row[]) {
    const a = touch(String(r.day));
    if (a) a.joins = num(r.n);
  }
  for (const r of db
    .prepare(
      `SELECT date(created_at_s, 'unixepoch') AS day, COUNT(*) AS n
       FROM action_log WHERE guild_id = ? AND action = 'member_leave' AND created_at_s >= ? GROUP BY day`
    )
    .all(guildId, windowStartS) as Row[]) {
    const a = touch(String(r.day));
    if (a) a.leaves = num(r.n);
  }

  // messages + distinct authors (DAU)
  for (const r of db
    .prepare(
      `SELECT date(created_at_s, 'unixepoch') AS day, COUNT(*) AS msgs, COUNT(DISTINCT user_id) AS authors
       FROM message_activity WHERE guild_id = ? AND created_at_s >= ? GROUP BY day`
    )
    .all(guildId, windowStartS) as Row[]) {
    const a = touch(String(r.day));
    if (a) {
      a.message_count = num(r.msgs);
      a.active_authors = num(r.authors);
    }
  }

  // voice minutes, each session capped at 6h, attributed to its join day
  for (const r of db
    .prepare(
      `SELECT date(joined_at_s, 'unixepoch') AS day,
              SUM(MIN(?, COALESCE(left_at_s, ?) - joined_at_s)) AS secs
       FROM voice_session
       WHERE guild_id = ? AND joined_at_s >= ? AND COALESCE(left_at_s, ?) > joined_at_s
       GROUP BY day`
    )
    .all(VOICE_SESSION_CAP_S, nowS, guildId, windowStartS, nowS) as Row[]) {
    const a = touch(String(r.day));
    if (a) a.voice_minutes = Math.round(num(r.secs) / 60);
  }

  // decisions from action_log terminal verbs only (never review_action)
  for (const r of db
    .prepare(
      `SELECT date(created_at_s, 'unixepoch') AS day,
              SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) AS appr,
              SUM(CASE WHEN action IN ('reject','perm_reject') THEN 1 ELSE 0 END) AS rej,
              SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) AS kick
       FROM action_log
       WHERE guild_id = ? AND created_at_s >= ?
         AND action IN ('approve','reject','perm_reject','kick')
       GROUP BY day`
    )
    .all(guildId, windowStartS) as Row[]) {
    const a = touch(String(r.day));
    if (a) {
      a.dec_approve = num(r.appr);
      a.dec_reject = num(r.rej);
      a.dec_kick = num(r.kick);
    }
  }

  // applications (TEXT timestamps): submitted by submitted_at, approved by resolved_at
  for (const r of db
    .prepare(
      `SELECT date(submitted_at) AS day, COUNT(*) AS n
       FROM application WHERE guild_id = ? AND submitted_at IS NOT NULL AND submitted_at >= ? GROUP BY day`
    )
    .all(guildId, windowStartISO) as Row[]) {
    const a = touch(String(r.day));
    if (a) a.apps_submitted = num(r.n);
  }
  for (const r of db
    .prepare(
      `SELECT date(resolved_at) AS day, COUNT(*) AS n
       FROM application WHERE guild_id = ? AND status = 'approved' AND resolved_at IS NOT NULL AND resolved_at >= ? GROUP BY day`
    )
    .all(guildId, windowStartISO) as Row[]) {
    const a = touch(String(r.day));
    if (a) a.apps_approved = num(r.n);
  }

  // baseline cumulative net before the window so the 90d curve is anchored.
  // From action_log append-only events (every join/leave counted once, never erased).
  const joinsBefore = num(
    (db.prepare(`SELECT COUNT(*) AS n FROM action_log WHERE guild_id = ? AND action = 'member_join' AND created_at_s < ?`).get(guildId, windowStartS) as Row).n
  );
  const leavesBefore = num(
    (db.prepare(`SELECT COUNT(*) AS n FROM action_log WHERE guild_id = ? AND action = 'member_leave' AND created_at_s < ?`).get(guildId, windowStartS) as Row).n
  );

  const wauStmt = db.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n FROM message_activity
     WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?`
  );

  const upsert = db.prepare(
    `INSERT INTO daily_metrics
       (guild_id, day, member_count, member_count_delta, joins, leaves, cumulative_net,
        message_count, message_count_prev7, active_authors, active_authors_7d, voice_minutes,
        dec_approve, dec_reject, dec_kick, apps_submitted, apps_approved, refreshed_at_s)
     VALUES (@guild_id, @day, @member_count, @member_count_delta, @joins, @leaves, @cumulative_net,
        @message_count, @message_count_prev7, @active_authors, @active_authors_7d, @voice_minutes,
        @dec_approve, @dec_reject, @dec_kick, @apps_submitted, @apps_approved, @refreshed_at_s)
     ON CONFLICT(guild_id, day) DO UPDATE SET
        member_count=excluded.member_count, member_count_delta=excluded.member_count_delta,
        joins=excluded.joins, leaves=excluded.leaves, cumulative_net=excluded.cumulative_net,
        message_count=excluded.message_count, message_count_prev7=excluded.message_count_prev7,
        active_authors=excluded.active_authors, active_authors_7d=excluded.active_authors_7d,
        voice_minutes=excluded.voice_minutes, dec_approve=excluded.dec_approve,
        dec_reject=excluded.dec_reject, dec_kick=excluded.dec_kick,
        apps_submitted=excluded.apps_submitted, apps_approved=excluded.apps_approved,
        refreshed_at_s=excluded.refreshed_at_s`
  );

  let running = joinsBefore - leavesBefore;
  let prevMember: number | null = null;
  for (let i = 0; i < dayList.length; i++) {
    const day = dayList[i]!;
    const a = acc.get(day)!;
    running += a.joins - a.leaves;
    const memberDelta = a.member_count != null && prevMember != null ? a.member_count - prevMember : null;
    const prev7 = i >= 7 ? acc.get(dayList[i - 7]!)!.message_count : null;
    const dayStartS = windowStartS + i * DAY_S;
    const wau = num((wauStmt.get(guildId, dayStartS - 6 * DAY_S, dayStartS + DAY_S) as Row).n);
    upsert.run({
      guild_id: guildId,
      day,
      member_count: a.member_count,
      member_count_delta: memberDelta,
      joins: a.joins,
      leaves: a.leaves,
      cumulative_net: running,
      message_count: a.message_count,
      message_count_prev7: prev7,
      active_authors: a.active_authors,
      active_authors_7d: wau,
      voice_minutes: a.voice_minutes,
      dec_approve: a.dec_approve,
      dec_reject: a.dec_reject,
      dec_kick: a.dec_kick,
      apps_submitted: a.apps_submitted,
      apps_approved: a.apps_approved,
      refreshed_at_s: nowS,
    });
    if (a.member_count != null) prevMember = a.member_count;
  }

  // prune rows older than the window so the table stays bounded
  db.prepare(`DELETE FROM daily_metrics WHERE guild_id = ? AND day < ?`).run(guildId, dayList[0]);
  return dayList.length;
}

function rebuildHeatmap(db: Database, guildId: string, nowS: number): number {
  db.prepare(`DELETE FROM activity_heatmap WHERE guild_id = ?`).run(guildId);
  const cutoff = utcMidnightS(nowS) - (HEATMAP_WINDOW_DAYS - 1) * DAY_S;
  const info = db
    .prepare(
      `INSERT INTO activity_heatmap (guild_id, dow, hour, msg_count)
       SELECT ?,
              (CAST(strftime('%w', created_at_s, 'unixepoch') AS INTEGER) + 6) % 7 AS dow,
              CAST(strftime('%H', created_at_s, 'unixepoch') AS INTEGER) AS hour,
              COUNT(*) AS n
       FROM message_activity
       WHERE guild_id = ? AND created_at_s >= ?
       GROUP BY dow, hour`
    )
    .run(guildId, guildId, cutoff);
  return info.changes;
}

function rebuildCohortRetention(db: Database, guildId: string, nowS: number): number {
  db.prepare(`DELETE FROM cohort_retention WHERE guild_id = ?`).run(guildId);
  const thisMonday = mondayStartS(nowS);
  const insert = db.prepare(
    `INSERT INTO cohort_retention (guild_id, cohort_week, week_offset, cohort_size, retained)
     VALUES (?, ?, ?, ?, ?)`
  );

  // Bucket each user by the week of their FIRST member_join so a later rejoin
  // never moves the user's cohort (user_activity would, because it upserts).
  // member events live in action_log (append-only); actor_id is the member.
  const lookbackStartS = thisMonday - COHORT_LOOKBACK_WEEKS * 7 * DAY_S;
  const firstJoins = db
    .prepare(
      `SELECT actor_id, MIN(created_at_s) AS first_join
       FROM action_log
       WHERE guild_id = ? AND action = 'member_join' AND created_at_s >= ?
       GROUP BY actor_id`
    )
    .all(guildId, lookbackStartS) as Row[];

  // Per-user "currently present" flag: the user's MOST RECENT membership event
  // (latest created_at_s among member_join / member_leave) is a member_join.
  const presentStmt = db.prepare(
    `SELECT action FROM action_log
     WHERE guild_id = ? AND actor_id = ? AND action IN ('member_join','member_leave')
     ORDER BY created_at_s DESC, id DESC
     LIMIT 1`
  );

  // Group cohort members by their first-join week and tally presence.
  const cohorts = new Map<number, { size: number; present: number }>();
  for (const u of firstJoins) {
    const weekStart = mondayStartS(num(u.first_join));
    const latest = presentStmt.get(guildId, String(u.actor_id)) as Row | undefined;
    const isPresent = latest != null && String(latest.action) === "member_join";
    const c = cohorts.get(weekStart) ?? { size: 0, present: 0 };
    c.size++;
    if (isPresent) c.present++;
    cohorts.set(weekStart, c);
  }

  let rows = 0;
  for (let w = 1; w <= COHORT_LOOKBACK_WEEKS; w++) {
    const weekStart = thisMonday - w * 7 * DAY_S;
    const c = cohorts.get(weekStart);
    if (!c || c.size === 0) continue;
    for (const offset of COHORT_OFFSETS) {
      const observeAt = weekStart + offset * 7 * DAY_S;
      if (observeAt > nowS) continue; // offset not yet observable
      // "Still present" is current-state (latest event is a join), preserved
      // across offsets so the row shape is unchanged for the dashboard.
      insert.run(guildId, utcDay(weekStart), offset, c.size, c.present);
      rows++;
    }
  }
  return rows;
}

function rebuildTenure(db: Database, guildId: string, nowS: number): void {
  db.prepare(`DELETE FROM tenure_buckets WHERE guild_id = ?`).run(guildId);
  const members = db
    .prepare(`SELECT joined_at FROM user_activity WHERE guild_id = ? AND left_at IS NULL`)
    .all(guildId) as Row[];
  const counts = new Array(TENURE_BUCKETS.length).fill(0);
  for (const m of members) {
    const tenure = nowS - num(m.joined_at);
    for (let i = 0; i < TENURE_BUCKETS.length; i++) {
      const maxS = TENURE_BUCKETS[i]!.maxS;
      if (maxS == null || tenure < maxS) {
        counts[i]++;
        break;
      }
    }
  }
  const insert = db.prepare(
    `INSERT INTO tenure_buckets (guild_id, bucket, member_count, sort_order) VALUES (?, ?, ?, ?)`
  );
  TENURE_BUCKETS.forEach((b, i) => insert.run(guildId, b.bucket, counts[i], i));
}

function rebuildChannelDaily(db: Database, guildId: string, windowStartS: number): number {
  db.prepare(`DELETE FROM channel_daily WHERE guild_id = ?`).run(guildId);
  const info = db
    .prepare(
      `INSERT INTO channel_daily (guild_id, day, channel_id, channel_name, msg_count)
       SELECT ma.guild_id,
              date(ma.created_at_s, 'unixepoch') AS day,
              ma.channel_id,
              cc.name,
              COUNT(*) AS n
       FROM message_activity ma
       LEFT JOIN channel_cache cc ON cc.guild_id = ma.guild_id AND cc.channel_id = ma.channel_id
       WHERE ma.guild_id = ? AND ma.created_at_s >= ?
       GROUP BY day, ma.channel_id`
    )
    .run(guildId, windowStartS);
  return info.changes;
}

function rebuildEventDaily(db: Database, guildId: string): number {
  db.prepare(`DELETE FROM event_daily WHERE guild_id = ?`).run(guildId);
  const info = db
    .prepare(
      `INSERT INTO event_daily (guild_id, event_date, event_type, qualified_count, total_count)
       SELECT guild_id, event_date, COALESCE(event_type, 'movie') AS event_type,
              SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END) AS q,
              COUNT(*) AS total
       FROM movie_attendance
       WHERE guild_id = ?
       GROUP BY event_date, event_type`
    )
    .run(guildId);
  return info.changes;
}

function rebuildQotdWeekly(db: Database, guildId: string, nowS: number): number {
  db.prepare(`DELETE FROM qotd_weekly WHERE guild_id = ?`).run(guildId);
  const lookbackStart = mondayStartS(nowS) - (QOTD_LOOKBACK_WEEKS - 1) * 7 * DAY_S;
  const rows = db
    .prepare(
      `SELECT status, created_at_s, reviewed_at_s, used_at_s
       FROM qotd_suggestion WHERE guild_id = ? AND created_at_s >= ?`
    )
    .all(guildId, lookbackStart) as Row[];
  const weeks = new Map<string, { submitted: number; approved: number; used: number }>();
  const bump = (s: number | null | undefined, key: "submitted" | "approved" | "used") => {
    if (s == null) return;
    const week = utcDay(mondayStartS(num(s)));
    const w = weeks.get(week) ?? { submitted: 0, approved: 0, used: 0 };
    w[key]++;
    weeks.set(week, w);
  };
  for (const r of rows) {
    bump(num(r.created_at_s), "submitted");
    const status = String(r.status);
    if ((status === "approved" || status === "used") && r.reviewed_at_s != null)
      bump(num(r.reviewed_at_s), "approved");
    if (status === "used" && r.used_at_s != null) bump(num(r.used_at_s), "used");
  }
  const insert = db.prepare(
    `INSERT INTO qotd_weekly (guild_id, week, submitted, approved, used) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [week, w] of weeks) insert.run(guildId, week, w.submitted, w.approved, w.used);
  return weeks.size;
}

function rebuildReactions(db: Database, guildId: string, nowS: number): number {
  db.prepare(`DELETE FROM reaction_emoji WHERE guild_id = ?`).run(guildId);
  const cutoff = utcMidnightS(nowS) - 90 * DAY_S;
  const info = db
    .prepare(
      `INSERT INTO reaction_emoji (guild_id, emoji, count)
       SELECT ?, r.emoji, COUNT(*) AS n
       FROM message_reactions_archive r
       JOIN messages_archive m ON m.message_id = r.message_id
       WHERE m.guild_id = ? AND r.reacted_at_s IS NOT NULL AND r.reacted_at_s >= ?
       GROUP BY r.emoji
       ORDER BY n DESC
       LIMIT ?`
    )
    .run(guildId, guildId, cutoff, REACTION_TOP_N);
  return info.changes;
}

function rebuildModLeaderboard(db: Database, guildId: string): number {
  db.prepare(`DELETE FROM mod_leaderboard WHERE guild_id = ?`).run(guildId);
  const rows = db
    .prepare(
      `SELECT moderator_id, total_accepts AS accepts, total_rejects AS rejects, total_kicks AS kicks,
              p50_response_time_s AS p50, p95_response_time_s AS p95
       FROM mod_metrics WHERE guild_id = ?
       ORDER BY total_accepts DESC, moderator_id ASC
       LIMIT ?`
    )
    .all(guildId, MOD_TOP_N) as Row[];
  const insert = db.prepare(
    `INSERT INTO mod_leaderboard
       (guild_id, moderator_id, display_label, accepts, rejects, kicks, p50_s, p95_s, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  rows.forEach((r, i) => {
    // Anonymized public label: Mod A, Mod B, ... in accepts-rank order.
    const label = `Mod ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`;
    insert.run(
      guildId,
      String(r.moderator_id),
      label,
      num(r.accepts),
      num(r.rejects),
      num(r.kicks),
      r.p50 == null ? null : num(r.p50),
      r.p95 == null ? null : num(r.p95),
      i
    );
  });
  return rows.length;
}
