import { db } from '$lib/server/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeWindow = '7d' | '30d' | '90d' | 'all';

export interface PersonalStats {
	total: number;
	approvals: number;
	rejections: number;
	permRejects: number;
	kicks: number;
	modmail: number;
	avgClaimToDecisionS: number | null;
	avgSubmitToClaimS: number | null;
}

export interface DailyCount {
	day: string; // "YYYY-MM-DD"
	count: number;
}

export interface DailyAvgSeconds {
	day: string;
	avg_seconds: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function windowStart(days: number): number {
	return Math.floor(Date.now() / 1000) - days * 86_400;
}

export function windowStartForWindow(window: TimeWindow): number {
	if (window === 'all') return 0;
	const days = window === '7d' ? 7 : window === '30d' ? 30 : 90;
	return Math.floor(Date.now() / 1000) - days * 86_400;
}

export function windowDaysForWindow(window: TimeWindow): number {
	if (window === 'all') return 36500; // ~100 years = all time
	return window === '7d' ? 7 : window === '30d' ? 30 : 90;
}

function fillGaps(rows: DailyCount[]): DailyCount[] {
	if (rows.length === 0) return rows;
	const map = new Map(rows.map((r) => [r.day, r.count]));
	const start = new Date(rows[0].day + 'T00:00:00Z');
	const end = new Date();
	const result: DailyCount[] = [];
	for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
		const key = d.toISOString().slice(0, 10);
		result.push({ day: key, count: map.get(key) ?? 0 });
	}
	return result;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const DECISION_ACTIONS = ['approve', 'reject', 'perm_reject', 'kick', 'modmail_open'];

/**
 * Personal action counts from action_log (time-windowed).
 * Uses actor_id (NOT moderator_id — that's review_action's column).
 */
export function getPersonalStats(
	userId: string,
	guildId: string,
	days = 30
): PersonalStats {
	const start = windowStart(days);

	const row = db()
		.prepare(
			`SELECT COUNT(*) as total,
				SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
				SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
				SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
				SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks,
				SUM(CASE WHEN action = 'modmail_open' THEN 1 ELSE 0 END) as modmail
			FROM action_log
			WHERE guild_id = ? AND actor_id = ?
				AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
				AND created_at_s >= ?`
		)
		.get(guildId, userId, start) as {
		total: number;
		approvals: number;
		rejections: number;
		perm_reject: number;
		kicks: number;
		modmail: number;
	} | undefined;

	const avgClaimToDecisionS = getClaimToDecisionAvg(userId, guildId, start);
	const avgSubmitToClaimS = getSubmitToFirstClaimAvg(guildId, start);

	return {
		total: row?.total ?? 0,
		approvals: row?.approvals ?? 0,
		rejections: row?.rejections ?? 0,
		permRejects: row?.perm_reject ?? 0,
		kicks: row?.kicks ?? 0,
		modmail: row?.modmail ?? 0,
		avgClaimToDecisionS,
		avgSubmitToClaimS
	};
}

/**
 * Average time from claim to decision for a specific moderator.
 * CTE pattern from src/commands/stats/shared.ts:getAvgClaimToDecision().
 */
export function getClaimToDecisionAvg(
	userId: string,
	guildId: string,
	windowStartS: number
): number | null {
	const row = db()
		.prepare(
			`WITH decisions AS (
				SELECT app_id, created_at_s as decision_time
				FROM action_log
				WHERE guild_id = ? AND actor_id = ?
					AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
					AND created_at_s >= ? AND app_id IS NOT NULL
			),
			claims AS (
				SELECT app_id, MAX(created_at_s) as claim_time
				FROM action_log
				WHERE guild_id = ? AND actor_id = ? AND action = 'claim'
				GROUP BY app_id
			)
			SELECT AVG(d.decision_time - c.claim_time) as avg_time
			FROM decisions d
			INNER JOIN claims c ON d.app_id = c.app_id
			WHERE c.claim_time < d.decision_time`
		)
		.get(guildId, userId, windowStartS, guildId, userId) as { avg_time: number | null } | undefined;

	return row?.avg_time ?? null;
}

/**
 * Server-wide average time from application submission to first claim.
 * CTE pattern from src/commands/stats/shared.ts:getAvgSubmitToFirstClaim().
 */
export function getSubmitToFirstClaimAvg(
	guildId: string,
	windowStartS: number
): number | null {
	const row = db()
		.prepare(
			`WITH submissions AS (
				SELECT app_id, created_at_s as submit_time
				FROM action_log
				WHERE guild_id = ? AND action = 'app_submitted' AND created_at_s >= ?
					AND app_id IS NOT NULL
			),
			first_claims AS (
				SELECT app_id, MIN(created_at_s) as claim_time
				FROM action_log
				WHERE guild_id = ? AND action = 'claim'
				GROUP BY app_id
			)
			SELECT AVG(c.claim_time - s.submit_time) as avg_time
			FROM submissions s
			INNER JOIN first_claims c ON s.app_id = c.app_id
			WHERE c.claim_time > s.submit_time`
		)
		.get(guildId, windowStartS, guildId) as { avg_time: number | null } | undefined;

	return row?.avg_time ?? null;
}

// ---------------------------------------------------------------------------
// Time-series queries
// ---------------------------------------------------------------------------

/**
 * Daily decision counts for a moderator. Gap-filled to produce a dense array.
 * Pass windowStartS=0 for all-time.
 */
export function getActivityTimeline(
	userId: string,
	guildId: string,
	windowStartS: number
): DailyCount[] {
	const rows = db()
		.prepare(
			`SELECT date(created_at_s, 'unixepoch') AS day, COUNT(*) AS count
			FROM action_log
			WHERE guild_id = ? AND actor_id = ?
				AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
				AND (? = 0 OR created_at_s >= ?)
			GROUP BY day
			ORDER BY day ASC`
		)
		.all(guildId, userId, windowStartS, windowStartS) as DailyCount[];

	return fillGaps(rows);
}

/**
 * Daily average claim-to-decision time for a moderator (sparse — only days with data).
 * Pass windowStartS=0 for all-time.
 */
export function getResponseTrend(
	userId: string,
	guildId: string,
	windowStartS: number
): DailyAvgSeconds[] {
	return db()
		.prepare(
			`WITH decisions AS (
				SELECT app_id, date(created_at_s, 'unixepoch') AS day, created_at_s AS decision_time
				FROM action_log
				WHERE guild_id = ? AND actor_id = ?
					AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
					AND app_id IS NOT NULL
					AND (? = 0 OR created_at_s >= ?)
			),
			claims AS (
				SELECT app_id, MAX(created_at_s) AS claim_time
				FROM action_log
				WHERE guild_id = ? AND actor_id = ? AND action = 'claim'
				GROUP BY app_id
			)
			SELECT d.day, ROUND(AVG(d.decision_time - c.claim_time)) AS avg_seconds
			FROM decisions d
			INNER JOIN claims c ON d.app_id = c.app_id
			WHERE c.claim_time < d.decision_time
			GROUP BY d.day
			ORDER BY d.day ASC`
		)
		.all(guildId, userId, windowStartS, windowStartS, guildId, userId) as DailyAvgSeconds[];
}
