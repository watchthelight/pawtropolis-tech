import { db } from '$lib/server/db';

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

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatHour(hour: number): string {
	if (hour === 0) return '12am';
	if (hour < 12) return `${hour}am`;
	if (hour === 12) return '12pm';
	return `${hour - 12}pm`;
}

/**
 * Calculate trends from heatmap week data.
 * Ported from src/lib/activityHeatmap.ts calculateTrends() — must produce
 * identical results so Discord command and dashboard show consistent data.
 */
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

	// Busiest hours: 3-hour sliding window
	const windowSize = 3;
	let maxSum = 0;
	let maxStart = 0;
	let minSum = Infinity;
	let minStart = 0;

	for (let i = 0; i <= 24 - windowSize; i++) {
		let sum = 0;
		for (let j = i; j < i + windowSize; j++) sum += hourlyTotals[j];
		if (sum > maxSum) { maxSum = sum; maxStart = i; }
		if (sum < minSum) { minSum = sum; minStart = i; }
	}

	const busiestHours = `${formatHour(maxStart)}\u2013${formatHour(maxStart + windowSize - 1)} UTC`;
	const leastActiveHours = `${formatHour(minStart)}\u2013${formatHour(minStart + windowSize - 1)} UTC`;

	// Peak and quietest days
	const maxDayValue = Math.max(...dayTotals);
	const minDayValue = Math.min(...dayTotals);
	const peakDays = dayTotals
		.map((val: number, idx: number) => (val === maxDayValue ? DAY_LABELS[idx] : null))
		.filter(Boolean) as string[];
	const quietestDays = dayTotals
		.map((val: number, idx: number) => (val === minDayValue ? DAY_LABELS[idx] : null))
		.filter(Boolean) as string[];

	const totalHours = weeks.length * 7 * 24;
	const avgMessagesPerHour = Math.round((totalMessages / totalHours) * 10) / 10;

	// Week-over-week growth: (newest - oldest) / oldest * 100
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
		weekOverWeekGrowth
	};
}

/**
 * Fetch heatmap data from message_activity table.
 * Mirrors src/lib/activityHeatmap.ts fetchActivityData() but uses web-side db.
 *
 * Queries by created_at_s range (uses idx_message_activity_guild_time index)
 * and aggregates into 7x24 grid in JS using UTC day/hour derivation.
 */
export function getHeatmapData(guildId: string, weeks: number = 1): HeatmapData {
	if (weeks < 1 || weeks > 8) weeks = 1;

	const now = new Date();
	const weeksData: HeatmapWeekData[] = [];

	for (let weekOffset = 0; weekOffset < weeks; weekOffset++) {
		const weekEnd = new Date(now);
		weekEnd.setUTCDate(now.getUTCDate() - weekOffset * 7);

		const weekStart = new Date(weekEnd);
		weekStart.setUTCDate(weekEnd.getUTCDate() - 7);

		const startTimestamp = Math.floor(weekStart.getTime() / 1000);
		const endTimestamp = Math.floor(weekEnd.getTime() / 1000);

		const rows = db()
			.prepare(
				`SELECT created_at_s FROM message_activity
				 WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?`
			)
			.all(guildId, startTimestamp, endTimestamp) as { created_at_s: number }[];

		// Initialize 7x24 grid (Mon-Sun x 0-23 hours)
		const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
		const dates: string[] = [];

		// Calculate ISO week dates (Monday first)
		const mondayOfWeek = new Date(weekStart);
		const daysSinceMonday = (mondayOfWeek.getUTCDay() + 6) % 7;
		mondayOfWeek.setUTCDate(mondayOfWeek.getUTCDate() - daysSinceMonday);

		for (let i = 0; i < 7; i++) {
			const date = new Date(mondayOfWeek);
			date.setUTCDate(mondayOfWeek.getUTCDate() + i);
			dates.push(date.toISOString());
		}

		// Aggregate by day index (Mon=0, Sun=6) and UTC hour
		for (const row of rows) {
			const date = new Date(row.created_at_s * 1000);
			const dayOfWeek = date.getUTCDay();
			const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
			const hour = date.getUTCHours();
			grid[dayIndex][hour] += 1;
		}

		weeksData.push({
			grid,
			startDate: dates[0],
			endDate: dates[6],
			dates
		});
	}

	const maxValue = Math.max(...weeksData.flatMap((w) => w.grid.flat()), 1);
	const trends = calculateTrends(weeksData);

	return { weeks: weeksData, maxValue, trends };
}
