import { db } from "$lib/server/db";
import type { ResolvedRange } from "$lib/shared/timeWindow";

// KEEP IN SYNC with tests/web/heatmap.test.ts (mirrored for vitest)
// If you change these interfaces or calculation logic, update the test mirror too.

export interface HeatmapWeekData {
  /** 2D array: [day 0-6][hour 0-23] where day 0 = Monday */
  grid: number[][];
  /** ISO string — Monday of this week */
  startDate: string;
  /** ISO string — Sunday of this week */
  endDate: string;
  /** 7 ISO strings, Mon-Sun */
  dates: string[];
}

export interface HeatmapTrends {
  busiestHours: string;
  leastActiveHours: string;
  peakDays: string[];
  quietestDays: string[];
  avgMessagesPerHour: number;
  totalMessages: number;
  weekOverWeekGrowth: number | null;
}

export interface HeatmapData {
  weeks: HeatmapWeekData[];
  maxValue: number;
  trends: HeatmapTrends;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Cap to keep the rendered grid sensible (and protect against abusive ranges). */
const MAX_WEEKS = 26;

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

function calculateTrends(weeks: HeatmapWeekData[]): HeatmapTrends {
  const hourlyTotals = new Array(24).fill(0);
  const dayTotals = new Array(7).fill(0);
  let totalMessages = 0;

  for (const week of weeks) {
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const value = week.grid[day][hour];
        hourlyTotals[hour] += value;
        dayTotals[day] += value;
        totalMessages += value;
      }
    }
  }

  const windowSize = 3;
  let maxSum = 0;
  let maxStart = 0;
  let minSum = Infinity;
  let minStart = 0;

  for (let i = 0; i <= 24 - windowSize; i++) {
    let sum = 0;
    for (let j = i; j < i + windowSize; j++) sum += hourlyTotals[j];
    if (sum > maxSum) {
      maxSum = sum;
      maxStart = i;
    }
    if (sum < minSum) {
      minSum = sum;
      minStart = i;
    }
  }

  const busiestHours = `${formatHour(maxStart)}–${formatHour(maxStart + windowSize - 1)} UTC`;
  const leastActiveHours = `${formatHour(minStart)}–${formatHour(minStart + windowSize - 1)} UTC`;

  const maxDayValue = Math.max(...dayTotals);
  const minDayValue = Math.min(...dayTotals);
  const peakDays = dayTotals
    .map((val: number, idx: number) => (val === maxDayValue ? DAY_LABELS[idx] : null))
    .filter(Boolean) as string[];
  const quietestDays = dayTotals
    .map((val: number, idx: number) => (val === minDayValue ? DAY_LABELS[idx] : null))
    .filter(Boolean) as string[];

  const totalHours = weeks.length * 7 * 24;
  const avgMessagesPerHour =
    totalHours === 0 ? 0 : Math.round((totalMessages / totalHours) * 10) / 10;

  let weekOverWeekGrowth: number | null = null;
  if (weeks.length >= 2) {
    const newestTotal = weeks[0].grid.flat().reduce((a, b) => a + b, 0);
    const oldestTotal = weeks[weeks.length - 1].grid.flat().reduce((a, b) => a + b, 0);
    if (oldestTotal > 0) {
      weekOverWeekGrowth = Math.round(((newestTotal - oldestTotal) / oldestTotal) * 1000) / 10;
    }
  }

  return {
    busiestHours,
    leastActiveHours,
    peakDays,
    quietestDays,
    avgMessagesPerHour,
    totalMessages,
    weekOverWeekGrowth,
  };
}

/**
 * Build one 7-day heatmap week starting at weekStart (unix seconds).
 * weekEnd is weekStart + 7 days. Day-0 of the grid is the Monday of weekStart.
 */
function buildWeek(guildId: string, weekStartS: number, weekEndS: number): HeatmapWeekData {
  const rows = db()
    .prepare(
      `SELECT (CAST(strftime('%w', created_at_s, 'unixepoch') AS INTEGER) + 6) % 7 AS dow,
              CAST(strftime('%H', created_at_s, 'unixepoch') AS INTEGER) AS hour,
              COUNT(*) AS n
       FROM message_activity
       WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?
       GROUP BY dow, hour`
    )
    .all(guildId, weekStartS, weekEndS) as { dow: number; hour: number; n: number }[];

  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const dates: string[] = [];

  // Anchor to ISO Monday of weekStartS so the grid stays Mon-Sun even for custom ranges.
  const weekStartDate = new Date(weekStartS * 1000);
  const mondayOfWeek = new Date(weekStartDate);
  const daysSinceMonday = (mondayOfWeek.getUTCDay() + 6) % 7;
  mondayOfWeek.setUTCDate(mondayOfWeek.getUTCDate() - daysSinceMonday);

  for (let i = 0; i < 7; i++) {
    const date = new Date(mondayOfWeek);
    date.setUTCDate(mondayOfWeek.getUTCDate() + i);
    dates.push(date.toISOString());
  }

  for (const row of rows) {
    grid[row.dow][row.hour] = row.n;
  }

  return {
    grid,
    startDate: dates[0],
    endDate: dates[6],
    dates,
  };
}

/**
 * Heatmap over a ResolvedRange. Slices the range into 7-day chunks ending at endS
 * and walking backwards. Capped at MAX_WEEKS. 'all' ranges (startS=0) fall back to
 * the last 8 weeks.
 */
export function getHeatmapDataForRange(guildId: string, range: ResolvedRange): HeatmapData {
  const endS = range.endS;
  let startS = range.startS;

  // "All time" is unbounded — show a rolling 8 weeks so the grid remains useful.
  if (startS === 0) {
    startS = endS - 8 * 7 * 86400;
  }

  const spanS = Math.max(endS - startS, 7 * 86400);
  let weeksCount = Math.ceil(spanS / (7 * 86400));
  if (weeksCount > MAX_WEEKS) weeksCount = MAX_WEEKS;
  if (weeksCount < 1) weeksCount = 1;

  const weeksData: HeatmapWeekData[] = [];
  for (let offset = 0; offset < weeksCount; offset++) {
    const weekEndS = endS - offset * 7 * 86400;
    // Clamp the oldest window so it never reaches before the requested range
    // when the span is not an exact multiple of 7 days.
    const weekStartS = Math.max(weekEndS - 7 * 86400, startS);
    weeksData.push(buildWeek(guildId, weekStartS, weekEndS));
  }

  const maxValue = Math.max(...weeksData.flatMap((w) => w.grid.flat()), 1);
  const trends = calculateTrends(weeksData);

  return { weeks: weeksData, maxValue, trends };
}

