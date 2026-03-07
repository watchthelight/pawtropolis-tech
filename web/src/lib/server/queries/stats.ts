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

export interface StatTrend {
	direction: 'up' | 'down' | 'neutral';
	delta: number;
	label: string;
}

export interface PersonalStatsTrend {
	total: StatTrend;
	approvals: StatTrend;
	rejections: StatTrend;
	avgClaimToDecision: StatTrend;
	avgSubmitToClaim: StatTrend;
}

export interface ReviewerStats {
	actorId: string;
	displayName: string;
	total: number;
	approvals: number;
	rejections: number;
	permRejects: number;
	kicks: number;
	modmail: number;
}

export interface TeamSummary {
	totalDecisions: number;
	activeReviewers: number;
	avgTeamResponseTimeS: number | null;
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

// ---------------------------------------------------------------------------
// Team stats
// ---------------------------------------------------------------------------

/**
 * Team-wide stats from action_log, matching the /stats leaderboard pattern.
 * Groups by actor_id, JOINs user_cache for display names.
 * Active reviewers = distinct actors with ≥1 decision action (not modmail_open).
 */
export function getTeamStats(
	guildId: string,
	windowStartS: number
): { summary: TeamSummary; reviewers: ReviewerStats[] } {
	const reviewers = db()
		.prepare(
			`SELECT
				a.actor_id,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(a.actor_id, -6)) as display_name,
				COUNT(*) as total,
				SUM(CASE WHEN a.action = 'approve' THEN 1 ELSE 0 END) as approvals,
				SUM(CASE WHEN a.action = 'reject' THEN 1 ELSE 0 END) as rejections,
				SUM(CASE WHEN a.action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
				SUM(CASE WHEN a.action = 'kick' THEN 1 ELSE 0 END) as kicks,
				SUM(CASE WHEN a.action = 'modmail_open' THEN 1 ELSE 0 END) as modmail
			FROM action_log a
			LEFT JOIN user_cache u ON a.actor_id = u.user_id AND u.guild_id = ?
			WHERE a.guild_id = ?
				AND a.action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
				AND (? = 0 OR a.created_at_s >= ?)
			GROUP BY a.actor_id
			ORDER BY total DESC, approvals DESC
			LIMIT 20`
		)
		.all(guildId, guildId, windowStartS, windowStartS) as {
		actor_id: string;
		display_name: string;
		total: number;
		approvals: number;
		rejections: number;
		perm_reject: number;
		kicks: number;
		modmail: number;
	}[];

	const mapped: ReviewerStats[] = reviewers.map((r) => ({
		actorId: r.actor_id,
		displayName: r.display_name,
		total: r.total,
		approvals: r.approvals,
		rejections: r.rejections,
		permRejects: r.perm_reject,
		kicks: r.kicks,
		modmail: r.modmail
	}));

	// Summary from unbounded query (not capped by LIMIT 20)
	const summaryRow = db()
		.prepare(
			`SELECT
				SUM(CASE WHEN action IN ('approve', 'reject', 'perm_reject', 'kick') THEN 1 ELSE 0 END) as total_decisions,
				COUNT(DISTINCT CASE WHEN action IN ('approve', 'reject', 'perm_reject', 'kick') THEN actor_id END) as active_reviewers
			FROM action_log
			WHERE guild_id = ?
				AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
				AND (? = 0 OR created_at_s >= ?)`
		)
		.get(guildId, windowStartS, windowStartS) as {
		total_decisions: number;
		active_reviewers: number;
	} | undefined;

	const totalDecisions = summaryRow?.total_decisions ?? 0;
	const activeReviewers = summaryRow?.active_reviewers ?? 0;

	// Team avg claim→decision time
	const avgRow = db()
		.prepare(
			`WITH decisions AS (
				SELECT app_id, created_at_s as decision_time
				FROM action_log
				WHERE guild_id = ?
					AND action IN ('approve', 'reject', 'perm_reject', 'kick')
					AND (? = 0 OR created_at_s >= ?)
					AND app_id IS NOT NULL
			),
			claims AS (
				SELECT app_id, MAX(created_at_s) as claim_time
				FROM action_log
				WHERE guild_id = ? AND action = 'claim'
				GROUP BY app_id
			)
			SELECT AVG(d.decision_time - c.claim_time) as avg_time
			FROM decisions d
			INNER JOIN claims c ON d.app_id = c.app_id
			WHERE c.claim_time < d.decision_time`
		)
		.get(guildId, windowStartS, windowStartS, guildId) as { avg_time: number | null } | undefined;

	return {
		summary: {
			totalDecisions,
			activeReviewers,
			avgTeamResponseTimeS: avgRow?.avg_time ?? null
		},
		reviewers: mapped
	};
}

// ---------------------------------------------------------------------------
// Trend comparison
// ---------------------------------------------------------------------------

const WINDOW_LABELS: Record<TimeWindow, string> = {
	'7d': 'last 7 days',
	'30d': 'last 30 days',
	'90d': 'last 90 days',
	all: ''
};

function countTrend(current: number, previous: number, window: TimeWindow): StatTrend {
	const delta = current - previous;
	const direction: StatTrend['direction'] = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
	const period = WINDOW_LABELS[window];
	let label: string;
	if (previous === 0 && current === 0) label = '';
	else if (previous === 0) label = 'Not enough data yet';
	else if (delta === 0) label = `No change vs ${period}`;
	else label = `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'} than ${period}`;
	return { direction, delta, label };
}

function timeTrend(
	currentS: number | null,
	previousS: number | null,
	window: TimeWindow
): StatTrend {
	if (currentS == null || previousS == null) {
		return { direction: 'neutral', delta: 0, label: previousS == null ? 'Not enough data yet' : '' };
	}
	const deltaS = currentS - previousS;
	// Inverted: lower time = good = 'up' (green)
	const direction: StatTrend['direction'] =
		deltaS < -30 ? 'up' : deltaS > 30 ? 'down' : 'neutral';
	const period = WINDOW_LABELS[window];
	const absDelta = Math.abs(deltaS);
	const hours = Math.floor(absDelta / 3600);
	const mins = Math.floor((absDelta % 3600) / 60);
	const fmt = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
	let label: string;
	if (Math.abs(deltaS) <= 30) label = `No change vs ${period}`;
	else if (deltaS < 0) label = `${fmt} faster than ${period}`;
	else label = `${fmt} slower than ${period}`;
	return { direction, delta: deltaS, label };
}

const NEUTRAL_TREND: StatTrend = { direction: 'neutral', delta: 0, label: '' };

/**
 * Compare current window stats against the equivalent previous period.
 * For 'all', returns neutral (no comparison possible).
 */
export function getPersonalStatsTrend(
	userId: string,
	guildId: string,
	window: TimeWindow
): PersonalStatsTrend {
	if (window === 'all') {
		return {
			total: NEUTRAL_TREND,
			approvals: NEUTRAL_TREND,
			rejections: NEUTRAL_TREND,
			avgClaimToDecision: NEUTRAL_TREND,
			avgSubmitToClaim: NEUTRAL_TREND
		};
	}

	const now = Math.floor(Date.now() / 1000);
	const days = windowDaysForWindow(window);
	const currentFrom = now - days * 86_400;
	const previousFrom = currentFrom - days * 86_400;

	// Current period stats (already computed by getPersonalStats with days param)
	const current = getPersonalStats(userId, guildId, days);

	// Previous period: query with a custom window
	const prevRow = db()
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
				AND created_at_s >= ? AND created_at_s < ?`
		)
		.get(guildId, userId, previousFrom, currentFrom) as {
		total: number;
		approvals: number;
		rejections: number;
		perm_reject: number;
		kicks: number;
		modmail: number;
	} | undefined;

	const prevTotal = prevRow?.total ?? 0;
	const prevApprovals = prevRow?.approvals ?? 0;
	const prevRejections = (prevRow?.rejections ?? 0) + (prevRow?.perm_reject ?? 0) + (prevRow?.kicks ?? 0);
	const currentRejections = current.rejections + current.permRejects + current.kicks;

	// Previous period response times (bounded — must NOT leak into current period)
	const prevClaimToDecisionRow = db()
		.prepare(
			`WITH decisions AS (
				SELECT app_id, created_at_s as decision_time
				FROM action_log
				WHERE guild_id = ? AND actor_id = ?
					AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
					AND created_at_s >= ? AND created_at_s < ? AND app_id IS NOT NULL
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
		.get(guildId, userId, previousFrom, currentFrom, guildId, userId) as { avg_time: number | null } | undefined;
	const prevClaimToDecision = prevClaimToDecisionRow?.avg_time ?? null;

	const prevSubmitToClaimRow = db()
		.prepare(
			`WITH submissions AS (
				SELECT app_id, created_at_s as submit_time
				FROM action_log
				WHERE guild_id = ? AND action = 'app_submitted'
					AND created_at_s >= ? AND created_at_s < ? AND app_id IS NOT NULL
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
		.get(guildId, previousFrom, currentFrom, guildId) as { avg_time: number | null } | undefined;
	const prevSubmitToClaim = prevSubmitToClaimRow?.avg_time ?? null;

	return {
		total: countTrend(current.total, prevTotal, window),
		approvals: countTrend(current.approvals, prevApprovals, window),
		rejections: countTrend(currentRejections, prevRejections, window),
		avgClaimToDecision: timeTrend(current.avgClaimToDecisionS, prevClaimToDecision, window),
		avgSubmitToClaim: timeTrend(current.avgSubmitToClaimS, prevSubmitToClaim, window)
	};
}
