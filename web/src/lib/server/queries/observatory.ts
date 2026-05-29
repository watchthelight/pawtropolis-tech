/**
 * Pawtropolis Tech -- web/src/lib/server/queries/observatory.ts
 * WHAT: Read-only data layer for the public /observatory stats page.
 * WHY: The page is zero-JS and must render fast and cache hard, so it reads
 *      ONLY the precomputed rollup tables (migration 078) and never touches a
 *      raw table at request time. All heavy aggregation already happened in
 *      scripts/refresh-public-stats.ts.
 * HOW: A handful of small PK / full-table reads of tables that never exceed a
 *      few hundred rows, shaped into render-ready series. No SVG/HTML here:
 *      presentation lives in the route.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "$lib/server/db";

const CHART_DAYS = 90;
const REACTION_LIMIT = 12;
const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface DayValue {
  day: string;
  value: number | null;
}
export interface JoinsLeavesPoint {
  day: string;
  joins: number;
  leaves: number;
}
export interface DailyDecisionPoint {
  day: string;
  approve: number;
  reject: number;
  kick: number;
}
export interface TenureBucket {
  bucket: string;
  count: number;
}
export interface CohortRow {
  week: string;
  size: number;
  offsets: { offset: number; retainedPct: number }[];
}
export interface TopChannel {
  name: string;
  count: number;
}
export interface EventRow {
  date: string;
  type: string;
  qualified: number;
  total: number;
}
export interface QotdWeek {
  week: string;
  submitted: number;
  approved: number;
  used: number;
}
export interface ReactionRow {
  emoji: string;
  count: number;
}
export interface ModRow {
  label: string;
  accepts: number;
  rejects: number;
  kicks: number;
  p50S: number | null;
  p95S: number | null;
}
export interface ObservatoryKpis {
  net30d: number;
  messages7d: number;
  messagesWoWPct: number | null;
  dauLatest: number;
  approvalRatePct: number | null;
  decisionP50S: number | null;
}
export interface ObservatoryData {
  refreshedAtS: number | null;
  currentMembers: number | null;
  memberSeries: DayValue[];
  kpis: ObservatoryKpis;
  joinsLeaves: JoinsLeavesPoint[];
  cumulativeNet: DayValue[];
  tenure: TenureBucket[];
  cohorts: CohortRow[];
  heatmap: number[][];
  heatmapMax: number;
  dowLabels: string[];
  messageVolume: DayValue[];
  dau: DayValue[];
  topChannels: TopChannel[];
  voice: DayValue[];
  events: EventRow[];
  qotd: QotdWeek[];
  reactions: ReactionRow[];
  decisionMix: { approve: number; reject: number; kick: number };
  dailyDecisions: DailyDecisionPoint[];
  mods: ModRow[];
  hasData: boolean;
}

interface DailyRow {
  day: string;
  member_count: number | null;
  joins: number;
  leaves: number;
  cumulative_net: number | null;
  message_count: number;
  message_count_prev7: number | null;
  active_authors: number;
  voice_minutes: number;
  dec_approve: number;
  dec_reject: number;
  dec_kick: number;
  apps_submitted: number;
  apps_approved: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function getObservatoryData(guildId: string): ObservatoryData {
  const d = db();

  const daily = d
    .prepare(
      `SELECT day, member_count, joins, leaves, cumulative_net, message_count, message_count_prev7,
              active_authors, voice_minutes, dec_approve, dec_reject, dec_kick, apps_submitted, apps_approved
       FROM daily_metrics WHERE guild_id = ? ORDER BY day ASC`
    )
    .all(guildId) as DailyRow[];
  const window = daily.slice(-CHART_DAYS);

  const memberSeries: DayValue[] = window.map((r) => ({ day: r.day, value: r.member_count }));
  const withMembers = window.filter((r) => r.member_count != null);
  const currentMembers = withMembers.length ? withMembers[withMembers.length - 1].member_count : null;

  // KPIs
  const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];
  const last30 = window.slice(-30);
  const net30d = last30.reduce((s, r) => s + r.joins - r.leaves, 0);
  const last7 = window.slice(-7);
  const prev7 = window.slice(-14, -7);
  const messages7d = last7.reduce((s, r) => s + r.message_count, 0);
  const messagesPrev7 = prev7.reduce((s, r) => s + r.message_count, 0);
  const messagesWoWPct =
    messagesPrev7 > 0 ? Math.round(((messages7d - messagesPrev7) / messagesPrev7) * 1000) / 10 : null;
  const dauLatest = last(window)?.active_authors ?? 0;
  const dec30 = last30.reduce(
    (s, r) => {
      s.a += r.dec_approve;
      s.r += r.dec_reject;
      s.k += r.dec_kick;
      return s;
    },
    { a: 0, r: 0, k: 0 }
  );
  const decTotal30 = dec30.a + dec30.r + dec30.k;
  const approvalRatePct = decTotal30 > 0 ? Math.round((dec30.a / decTotal30) * 1000) / 10 : null;

  // Heatmap (fill 7x24 grid)
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let heatmapMax = 0;
  for (const row of d
    .prepare(`SELECT dow, hour, msg_count FROM activity_heatmap WHERE guild_id = ?`)
    .all(guildId) as { dow: number; hour: number; msg_count: number }[]) {
    if (row.dow >= 0 && row.dow < 7 && row.hour >= 0 && row.hour < 24) {
      heatmap[row.dow][row.hour] = row.msg_count;
      if (row.msg_count > heatmapMax) heatmapMax = row.msg_count;
    }
  }

  // Tenure
  const tenure = (
    d
      .prepare(`SELECT bucket, member_count FROM tenure_buckets WHERE guild_id = ? ORDER BY sort_order ASC`)
      .all(guildId) as { bucket: string; member_count: number }[]
  ).map((r) => ({ bucket: r.bucket, count: r.member_count }));

  // Cohorts
  const cohortRows = d
    .prepare(
      `SELECT cohort_week, week_offset, cohort_size, retained FROM cohort_retention
       WHERE guild_id = ? ORDER BY cohort_week ASC, week_offset ASC`
    )
    .all(guildId) as { cohort_week: string; week_offset: number; cohort_size: number; retained: number }[];
  const cohortMap = new Map<string, CohortRow>();
  for (const r of cohortRows) {
    const c = cohortMap.get(r.cohort_week) ?? { week: r.cohort_week, size: r.cohort_size, offsets: [] };
    c.offsets.push({
      offset: r.week_offset,
      retainedPct: r.cohort_size > 0 ? Math.round((r.retained / r.cohort_size) * 100) : 0,
    });
    cohortMap.set(r.cohort_week, c);
  }
  const cohorts = [...cohortMap.values()];

  // Top channels (sum over window, top 5 + Other)
  const channelTotals = d
    .prepare(
      `SELECT channel_id, MAX(channel_name) AS channel_name, SUM(msg_count) AS total
       FROM channel_daily WHERE guild_id = ? GROUP BY channel_id ORDER BY total DESC`
    )
    .all(guildId) as { channel_id: string; channel_name: string | null; total: number }[];
  const topChannels: TopChannel[] = channelTotals.slice(0, 5).map((c) => ({
    name: c.channel_name ?? `channel ${c.channel_id.slice(-4)}`,
    count: c.total,
  }));
  const otherCount = channelTotals.slice(5).reduce((s, c) => s + c.total, 0);
  if (otherCount > 0) topChannels.push({ name: "other", count: otherCount });

  // Events / QOTD / reactions
  const events = (
    d
      .prepare(
        `SELECT event_date, event_type, qualified_count, total_count FROM event_daily
         WHERE guild_id = ? ORDER BY event_date DESC LIMIT 12`
      )
      .all(guildId) as { event_date: string; event_type: string; qualified_count: number; total_count: number }[]
  )
    .map((r) => ({ date: r.event_date, type: r.event_type, qualified: r.qualified_count, total: r.total_count }))
    .reverse();

  const qotd = (
    d
      .prepare(
        `SELECT week, submitted, approved, used FROM qotd_weekly WHERE guild_id = ? ORDER BY week ASC`
      )
      .all(guildId) as QotdWeek[]
  ).slice(-12);

  const reactions = (
    d
      .prepare(
        `SELECT emoji, count FROM reaction_emoji WHERE guild_id = ? ORDER BY count DESC LIMIT ?`
      )
      .all(guildId, REACTION_LIMIT) as ReactionRow[]
  );

  // Moderation: anonymized labels only; never expose moderator_id to the public.
  const mods = (
    d
      .prepare(
        `SELECT display_label, accepts, rejects, kicks, p50_s, p95_s FROM mod_leaderboard
         WHERE guild_id = ? ORDER BY sort_order ASC`
      )
      .all(guildId) as {
      display_label: string | null;
      accepts: number;
      rejects: number;
      kicks: number;
      p50_s: number | null;
      p95_s: number | null;
    }[]
  ).map((r, i) => ({
    label: r.display_label ?? `Mod ${String.fromCharCode(65 + (i % 26))}`,
    accepts: r.accepts,
    rejects: r.rejects,
    kicks: r.kicks,
    p50S: r.p50_s,
    p95S: r.p95_s,
  }));
  const decisionP50S = median(mods.map((m) => m.p50S).filter((v): v is number => v != null));

  const refreshedRow = d
    .prepare(`SELECT refreshed_at_s FROM rollup_meta WHERE guild_id = ?`)
    .get(guildId) as { refreshed_at_s: number } | undefined;

  const decisionMix = window.reduce(
    (s, r) => {
      s.approve += r.dec_approve;
      s.reject += r.dec_reject;
      s.kick += r.dec_kick;
      return s;
    },
    { approve: 0, reject: 0, kick: 0 }
  );

  return {
    refreshedAtS: refreshedRow?.refreshed_at_s ?? null,
    currentMembers,
    memberSeries,
    kpis: { net30d, messages7d, messagesWoWPct, dauLatest, approvalRatePct, decisionP50S },
    joinsLeaves: window.map((r) => ({ day: r.day, joins: r.joins, leaves: r.leaves })),
    cumulativeNet: window.map((r) => ({ day: r.day, value: r.cumulative_net })),
    tenure,
    cohorts,
    heatmap,
    heatmapMax,
    dowLabels: DOW_LABELS,
    messageVolume: window.map((r) => ({ day: r.day, value: r.message_count })),
    dau: window.map((r) => ({ day: r.day, value: r.active_authors })),
    topChannels,
    voice: window.map((r) => ({ day: r.day, value: r.voice_minutes })),
    events,
    qotd,
    reactions,
    decisionMix,
    dailyDecisions: window.map((r) => ({
      day: r.day,
      approve: r.dec_approve,
      reject: r.dec_reject,
      kick: r.dec_kick,
    })),
    mods,
    hasData: daily.length > 0,
  };
}
