/**
 * Pawtropolis Tech — tests/web/heatmap.test.ts
 * WHAT: Unit tests for heatmap query helpers — trends calculation, grid aggregation, week alignment.
 * WHY: Verify heatmap data processing matches bot-side activityHeatmap.ts output for consistent display.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from 'vitest';

// KEEP IN SYNC with web/src/lib/server/queries/heatmap.ts (formatHour)
function formatHour(hour: number): string {
	if (hour === 0) return '12am';
	if (hour < 12) return `${hour}am`;
	if (hour === 12) return '12pm';
	return `${hour - 12}pm`;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// KEEP IN SYNC with web/src/lib/server/queries/heatmap.ts (calculateTrends)
// Mirrored because vitest can't resolve $lib/ aliases.
function calculateTrends(
	weeks: { grid: number[][] }[],
) {
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
		if (sum > maxSum) { maxSum = sum; maxStart = i; }
		if (sum < minSum) { minSum = sum; minStart = i; }
	}

	const busiestHours = `${formatHour(maxStart)}\u2013${formatHour(maxStart + windowSize - 1)} UTC`;
	const leastActiveHours = `${formatHour(minStart)}\u2013${formatHour(minStart + windowSize - 1)} UTC`;

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

// KEEP IN SYNC with web/src/lib/server/queries/heatmap.ts (grid aggregation)
function aggregateRows(rows: { created_at_s: number }[]): number[][] {
	const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
	for (const row of rows) {
		const date = new Date(row.created_at_s * 1000);
		const dayOfWeek = date.getUTCDay();
		const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
		const hour = date.getUTCHours();
		grid[dayIndex][hour] += 1;
	}
	return grid;
}

// KEEP IN SYNC with web/src/lib/server/queries/heatmap.ts (week date alignment)
function getWeekDates(referenceDate: Date): string[] {
	const mondayOfWeek = new Date(referenceDate);
	const daysSinceMonday = (mondayOfWeek.getUTCDay() + 6) % 7;
	mondayOfWeek.setUTCDate(mondayOfWeek.getUTCDate() - daysSinceMonday);

	const dates: string[] = [];
	for (let i = 0; i < 7; i++) {
		const date = new Date(mondayOfWeek);
		date.setUTCDate(mondayOfWeek.getUTCDate() + i);
		dates.push(date.toISOString());
	}
	return dates;
}

describe('heatmap helpers', () => {
	describe('formatHour', () => {
		it('formats midnight as 12am', () => {
			expect(formatHour(0)).toBe('12am');
		});

		it('formats noon as 12pm', () => {
			expect(formatHour(12)).toBe('12pm');
		});

		it('formats morning hours correctly', () => {
			expect(formatHour(1)).toBe('1am');
			expect(formatHour(11)).toBe('11am');
		});

		it('formats afternoon hours correctly', () => {
			expect(formatHour(13)).toBe('1pm');
			expect(formatHour(23)).toBe('11pm');
		});
	});

	describe('grid aggregation', () => {
		it('maps created_at_s to correct day and hour slots', () => {
			// 2026-03-09 is a Monday, 14:00 UTC
			const mondayEpoch = Date.UTC(2026, 2, 9, 14, 30, 0) / 1000;
			// 2026-03-15 is a Sunday, 03:00 UTC
			const sundayEpoch = Date.UTC(2026, 2, 15, 3, 15, 0) / 1000;

			const grid = aggregateRows([
				{ created_at_s: mondayEpoch },
				{ created_at_s: sundayEpoch },
			]);

			expect(grid[0][14]).toBe(1); // Monday (index 0), hour 14
			expect(grid[6][3]).toBe(1);  // Sunday (index 6), hour 3
		});

		it('accumulates multiple messages in same slot', () => {
			const epoch1 = Date.UTC(2026, 2, 10, 10, 0, 0) / 1000;  // Tuesday 10:00
			const epoch2 = Date.UTC(2026, 2, 10, 10, 30, 0) / 1000; // Tuesday 10:30

			const grid = aggregateRows([
				{ created_at_s: epoch1 },
				{ created_at_s: epoch2 },
			]);

			expect(grid[1][10]).toBe(2); // Tuesday (index 1), hour 10
		});

		it('returns all zeros for empty input', () => {
			const grid = aggregateRows([]);
			expect(grid).toHaveLength(7);
			for (const day of grid) {
				expect(day).toHaveLength(24);
				expect(day.every(v => v === 0)).toBe(true);
			}
		});

		it('handles Saturday correctly (JS day 6 → index 5)', () => {
			// 2026-03-14 is a Saturday
			const satEpoch = Date.UTC(2026, 2, 14, 20, 0, 0) / 1000;
			const grid = aggregateRows([{ created_at_s: satEpoch }]);
			expect(grid[5][20]).toBe(1); // Saturday (index 5), hour 20
		});
	});

	describe('week date alignment', () => {
		it('returns 7 ISO date strings', () => {
			const dates = getWeekDates(new Date('2026-03-12T00:00:00Z'));
			expect(dates).toHaveLength(7);
			dates.forEach(d => expect(d).toMatch(/^\d{4}-\d{2}-\d{2}T/));
		});

		it('starts on Monday', () => {
			// 2026-03-12 is Thursday. Monday of that week is 2026-03-09.
			const dates = getWeekDates(new Date('2026-03-12T00:00:00Z'));
			const monday = new Date(dates[0]);
			expect(monday.getUTCDay()).toBe(1); // Monday
		});

		it('ends on Sunday', () => {
			const dates = getWeekDates(new Date('2026-03-12T00:00:00Z'));
			const sunday = new Date(dates[6]);
			expect(sunday.getUTCDay()).toBe(0); // Sunday
		});

		it('handles Sunday input correctly (aligns to previous Monday)', () => {
			// 2026-03-15 is Sunday. Monday of that week is 2026-03-09.
			const dates = getWeekDates(new Date('2026-03-15T00:00:00Z'));
			const monday = new Date(dates[0]);
			expect(monday.getUTCDate()).toBe(9);
		});

		it('handles Monday input (already aligned)', () => {
			const dates = getWeekDates(new Date('2026-03-09T00:00:00Z'));
			const monday = new Date(dates[0]);
			expect(monday.getUTCDate()).toBe(9);
			expect(monday.getUTCDay()).toBe(1);
		});
	});

	describe('calculateTrends', () => {
		function makeGrid(fill: number = 0): number[][] {
			return Array.from({ length: 7 }, () => new Array(24).fill(fill));
		}

		it('calculates totalMessages correctly', () => {
			const grid = makeGrid(0);
			grid[0][10] = 5;
			grid[3][14] = 10;
			const trends = calculateTrends([{ grid }]);
			expect(trends.totalMessages).toBe(15);
		});

		it('returns zero totalMessages for empty grid', () => {
			const trends = calculateTrends([{ grid: makeGrid(0) }]);
			expect(trends.totalMessages).toBe(0);
		});

		it('identifies busiest hours using 3-hour sliding window', () => {
			const grid = makeGrid(0);
			// Make hours 14, 15, 16 the busiest
			for (let day = 0; day < 7; day++) {
				grid[day][14] = 50;
				grid[day][15] = 60;
				grid[day][16] = 40;
			}
			const trends = calculateTrends([{ grid }]);
			expect(trends.busiestHours).toBe('2pm\u20134pm UTC');
		});

		it('identifies least active hours', () => {
			const grid = makeGrid(10);
			// Make hours 2, 3, 4 the quietest
			for (let day = 0; day < 7; day++) {
				grid[day][2] = 0;
				grid[day][3] = 0;
				grid[day][4] = 0;
			}
			const trends = calculateTrends([{ grid }]);
			expect(trends.leastActiveHours).toBe('2am\u20134am UTC');
		});

		it('identifies peak days', () => {
			const grid = makeGrid(0);
			// Saturday (index 5) is busiest
			for (let hour = 0; hour < 24; hour++) {
				grid[5][hour] = 100;
			}
			const trends = calculateTrends([{ grid }]);
			expect(trends.peakDays).toEqual(['Sat']);
		});

		it('identifies quietest days', () => {
			const grid = makeGrid(10);
			// Tuesday (index 1) is quietest
			for (let hour = 0; hour < 24; hour++) {
				grid[1][hour] = 0;
			}
			const trends = calculateTrends([{ grid }]);
			expect(trends.quietestDays).toEqual(['Tue']);
		});

		it('returns multiple peak days when tied', () => {
			const grid = makeGrid(0);
			for (let hour = 0; hour < 24; hour++) {
				grid[5][hour] = 50; // Saturday
				grid[6][hour] = 50; // Sunday
			}
			const trends = calculateTrends([{ grid }]);
			expect(trends.peakDays).toEqual(['Sat', 'Sun']);
		});

		it('calculates avgMessagesPerHour', () => {
			const grid = makeGrid(0);
			// 168 cells (7*24), put 168 messages total = 1.0 avg
			grid[0][0] = 168;
			const trends = calculateTrends([{ grid }]);
			expect(trends.avgMessagesPerHour).toBe(1);
		});

		it('returns null weekOverWeekGrowth for single week', () => {
			const trends = calculateTrends([{ grid: makeGrid(10) }]);
			expect(trends.weekOverWeekGrowth).toBeNull();
		});

		it('calculates weekOverWeekGrowth for two weeks', () => {
			const oldGrid = makeGrid(0);
			oldGrid[0][0] = 100; // oldest week: 100 messages
			const newGrid = makeGrid(0);
			newGrid[0][0] = 150; // newest week: 150 messages

			// weeks[0] is newest, weeks[1] is oldest
			const trends = calculateTrends([{ grid: newGrid }, { grid: oldGrid }]);
			expect(trends.weekOverWeekGrowth).toBe(50); // 50% growth
		});

		it('returns null weekOverWeekGrowth when oldest week has zero messages', () => {
			const oldGrid = makeGrid(0); // zero messages
			const newGrid = makeGrid(0);
			newGrid[0][0] = 100;

			const trends = calculateTrends([{ grid: newGrid }, { grid: oldGrid }]);
			expect(trends.weekOverWeekGrowth).toBeNull();
		});

		it('calculates negative growth correctly', () => {
			const oldGrid = makeGrid(0);
			oldGrid[0][0] = 200;
			const newGrid = makeGrid(0);
			newGrid[0][0] = 100;

			const trends = calculateTrends([{ grid: newGrid }, { grid: oldGrid }]);
			expect(trends.weekOverWeekGrowth).toBe(-50); // -50% decline
		});
	});
});
