import { db } from '$lib/server/db';
import type { ResolvedRange } from '$lib/shared/timeWindow';
import { comparisonLabel } from '$lib/shared/timeWindow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/**
 * Range SQL fragment. SQLite cannot use parameters for clauses that vary
 * structurally, but can use `(? = 0 OR col >= ?)` for the start and always-true
 * `col < ?` for the end. We always pass both.
 */
function rangeBounds(r: ResolvedRange): { startS: number; endS: number } {
	return { startS: r.startS, endS: r.endS };
}

function fillGaps(rows: DailyCount[], endS: number): DailyCount[] {
	if (rows.length === 0) return rows;
	const map = new Map(rows.map((r) => [r.day, r.count]));
	const start = new Date(rows[0].day + 'T00:00:00Z');
	const end = new Date(endS * 1000);
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

/**
 * Personal action counts from action_log over an arbitrary range.
 * Uses actor_id (NOT moderator_id — that's review_action's column).
 */
export function getPersonalStats(
	userId: string,
	guildId: string,
	range: ResolvedRange
): PersonalStats {
	const { startS, endS } = rangeBounds(range);

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
				AND (? = 0 OR created_at_s >= ?)
				AND created_at_s < ?`
		)
		.get(guildId, userId, startS, startS, endS) as {
		total: number;
		approvals: number;
		rejections: number;
		perm_reject: number;
		kicks: number;
		modmail: number;
	} | undefined;

	const avgClaimToDecisionS = getClaimToDecisionAvg(userId, guildId, startS, endS);
	const avgSubmitToClaimS = getSubmitToFirstClaimAvg(guildId, startS, endS);

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

export function getClaimToDecisionAvg(
	userId: string,
	guildId: string,
	startS: number,
	endS: number
): number | null {
	const row = db()
		.prepare(
			`WITH decisions AS (
				SELECT app_id, created_at_s as decision_time
				FROM action_log
				WHERE guild_id = ? AND actor_id = ?
					AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
					AND (? = 0 OR created_at_s >= ?) AND created_at_s < ? AND app_id IS NOT NULL
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
		.get(guildId, userId, startS, startS, endS, guildId, userId) as {
		avg_time: number | null;
	} | undefined;

	return row?.avg_time ?? null;
}

export function getSubmitToFirstClaimAvg(
	guildId: string,
	startS: number,
	endS: number
): number | null {
	const row = db()
		.prepare(
			`WITH submissions AS (
				SELECT app_id, created_at_s as submit_time
				FROM action_log
				WHERE guild_id = ? AND action = 'app_submitted'
					AND (? = 0 OR created_at_s >= ?) AND created_at_s < ?
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
		.get(guildId, startS, startS, endS, guildId) as { avg_time: number | null } | undefined;

	return row?.avg_time ?? null;
}

// ---------------------------------------------------------------------------
// Time-series
// ---------------------------------------------------------------------------

export function getActivityTimeline(
	userId: string,
	guildId: string,
	range: ResolvedRange
): DailyCount[] {
	const { startS, endS } = rangeBounds(range);
	const rows = db()
		.prepare(
			`SELECT date(created_at_s, 'unixepoch') AS day, COUNT(*) AS count
			FROM action_log
			WHERE guild_id = ? AND actor_id = ?
				AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
				AND (? = 0 OR created_at_s >= ?) AND created_at_s < ?
			GROUP BY day
			ORDER BY day ASC`
		)
		.all(guildId, userId, startS, startS, endS) as DailyCount[];

	return fillGaps(rows, endS);
}

export function getResponseTrend(
	userId: string,
	guildId: string,
	range: ResolvedRange
): DailyAvgSeconds[] {
	const { startS, endS } = rangeBounds(range);
	return db()
		.prepare(
			`WITH decisions AS (
				SELECT app_id, date(created_at_s, 'unixepoch') AS day, created_at_s AS decision_time
				FROM action_log
				WHERE guild_id = ? AND actor_id = ?
					AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
					AND app_id IS NOT NULL
					AND (? = 0 OR created_at_s >= ?) AND created_at_s < ?
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
		.all(guildId, userId, startS, startS, endS, guildId, userId) as DailyAvgSeconds[];
}

// ---------------------------------------------------------------------------
// Team stats
// ---------------------------------------------------------------------------

export function getTeamStats(
	guildId: string,
	range: ResolvedRange
): { summary: TeamSummary; reviewers: ReviewerStats[] } {
	const { startS, endS } = rangeBounds(range);

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
				AND (? = 0 OR a.created_at_s >= ?) AND a.created_at_s < ?
			GROUP BY a.actor_id
			ORDER BY total DESC, approvals DESC
			LIMIT 20`
		)
		.all(guildId, guildId, startS, startS, endS) as {
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

	const summaryRow = db()
		.prepare(
			`SELECT
				SUM(CASE WHEN action IN ('approve', 'reject', 'perm_reject', 'kick') THEN 1 ELSE 0 END) as total_decisions,
				COUNT(DISTINCT CASE WHEN action IN ('approve', 'reject', 'perm_reject', 'kick') THEN actor_id END) as active_reviewers
			FROM action_log
			WHERE guild_id = ?
				AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
				AND (? = 0 OR created_at_s >= ?) AND created_at_s < ?`
		)
		.get(guildId, startS, startS, endS) as {
		total_decisions: number;
		active_reviewers: number;
	} | undefined;

	const totalDecisions = summaryRow?.total_decisions ?? 0;
	const activeReviewers = summaryRow?.active_reviewers ?? 0;

	const avgRow = db()
		.prepare(
			`WITH decisions AS (
				SELECT app_id, created_at_s as decision_time
				FROM action_log
				WHERE guild_id = ?
					AND action IN ('approve', 'reject', 'perm_reject', 'kick')
					AND (? = 0 OR created_at_s >= ?) AND created_at_s < ?
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
		.get(guildId, startS, startS, endS, guildId) as { avg_time: number | null } | undefined;

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
// Trend comparison (current window vs same-length prior window)
// ---------------------------------------------------------------------------

function countTrend(current: number, previous: number, periodLabel: string): StatTrend {
	const delta = current - previous;
	const direction: StatTrend['direction'] = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
	let label: string;
	if (previous === 0 && current === 0) label = '';
	else if (previous === 0) label = 'Not enough data yet';
	else if (delta === 0) label = `No change vs ${periodLabel}`;
	else label = `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'} than ${periodLabel}`;
	return { direction, delta, label };
}

function timeTrend(
	currentS: number | null,
	previousS: number | null,
	periodLabel: string
): StatTrend {
	if (currentS == null || previousS == null) {
		return {
			direction: 'neutral',
			delta: 0,
			label: previousS == null ? 'Not enough data yet' : ''
		};
	}
	const deltaS = currentS - previousS;
	const direction: StatTrend['direction'] =
		deltaS < -30 ? 'up' : deltaS > 30 ? 'down' : 'neutral';
	const absDelta = Math.abs(deltaS);
	const hours = Math.floor(absDelta / 3600);
	const mins = Math.floor((absDelta % 3600) / 60);
	const fmt = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
	let label: string;
	if (Math.abs(deltaS) <= 30) label = `No change vs ${periodLabel}`;
	else if (deltaS < 0) label = `${fmt} faster than ${periodLabel}`;
	else label = `${fmt} slower than ${periodLabel}`;
	return { direction, delta: deltaS, label };
}

const NEUTRAL_TREND: StatTrend = { direction: 'neutral', delta: 0, label: '' };

export function getPersonalStatsTrend(
	userId: string,
	guildId: string,
	range: ResolvedRange,
	currentStats?: PersonalStats
): PersonalStatsTrend {
	if (range.prevStartS == null) {
		return {
			total: NEUTRAL_TREND,
			approvals: NEUTRAL_TREND,
			rejections: NEUTRAL_TREND,
			avgClaimToDecision: NEUTRAL_TREND,
			avgSubmitToClaim: NEUTRAL_TREND
		};
	}

	const currentFrom = range.startS;
	const currentTo = range.endS;
	const previousFrom = range.prevStartS;
	const previousTo = currentFrom;
	const periodLabel = comparisonLabel(range.spec);

	const current = currentStats ?? getPersonalStats(userId, guildId, range);

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
		.get(guildId, userId, previousFrom, previousTo) as {
		total: number;
		approvals: number;
		rejections: number;
		perm_reject: number;
		kicks: number;
		modmail: number;
	} | undefined;

	const prevTotal = prevRow?.total ?? 0;
	const prevApprovals = prevRow?.approvals ?? 0;
	const prevRejections =
		(prevRow?.rejections ?? 0) + (prevRow?.perm_reject ?? 0) + (prevRow?.kicks ?? 0);
	const currentRejections = current.rejections + current.permRejects + current.kicks;

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
		.get(guildId, userId, previousFrom, previousTo, guildId, userId) as {
		avg_time: number | null;
	} | undefined;
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
		.get(guildId, previousFrom, previousTo, guildId) as { avg_time: number | null } | undefined;
	const prevSubmitToClaim = prevSubmitToClaimRow?.avg_time ?? null;

	// currentFrom/currentTo unused here — suppress lint
	void currentFrom;
	void currentTo;

	return {
		total: countTrend(current.total, prevTotal, periodLabel),
		approvals: countTrend(current.approvals, prevApprovals, periodLabel),
		rejections: countTrend(currentRejections, prevRejections, periodLabel),
		avgClaimToDecision: timeTrend(current.avgClaimToDecisionS, prevClaimToDecision, periodLabel),
		avgSubmitToClaim: timeTrend(current.avgSubmitToClaimS, prevSubmitToClaim, periodLabel)
	};
}

// ---------------------------------------------------------------------------
// Per-Mod Decision Breakdown
// ---------------------------------------------------------------------------

export interface ModBreakdown {
	modId: string;
	total: number;
	approvals: number;
	rejections: number;
	kicks: number;
	approvalRate: number;
	avgDecisionTimeS: number | null;
}

export function getModBreakdowns(guildId: string, range: ResolvedRange): ModBreakdown[] {
	const { startS, endS } = rangeBounds(range);
	const rows = db()
		.prepare(
			`SELECT
				actor_id as mod_id,
				COUNT(*) as total,
				SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
				SUM(CASE WHEN action IN ('reject', 'perm_reject') THEN 1 ELSE 0 END) as rejections,
				SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks,
				AVG(CASE
					WHEN action IN ('approve', 'reject', 'perm_reject', 'kick') THEN
						created_at_s - COALESCE(
							(SELECT MIN(c2.created_at_s) FROM action_log c2
							 WHERE c2.app_id = action_log.app_id AND c2.action = 'claim'),
							created_at_s
						)
					ELSE NULL
				END) as avg_decision_time_s
			FROM action_log
			WHERE guild_id = ?
				AND action IN ('approve', 'reject', 'perm_reject', 'kick')
				AND (? = 0 OR created_at_s >= ?) AND created_at_s < ?
			GROUP BY actor_id
			ORDER BY total DESC
			LIMIT 20`
		)
		.all(guildId, startS, startS, endS) as Array<{
		mod_id: string;
		total: number;
		approvals: number;
		rejections: number;
		kicks: number;
		avg_decision_time_s: number | null;
	}>;

	return rows.map((r) => ({
		modId: r.mod_id,
		total: r.total,
		approvals: r.approvals,
		rejections: r.rejections,
		kicks: r.kicks,
		approvalRate: r.total > 0 ? Math.round((r.approvals / r.total) * 100) : 0,
		avgDecisionTimeS: r.avg_decision_time_s ? Math.round(r.avg_decision_time_s) : null
	}));
}

// ---------------------------------------------------------------------------
// Time-to-Decision Percentiles
// ---------------------------------------------------------------------------

export interface DecisionPercentiles {
	p50: number | null;
	p75: number | null;
	p95: number | null;
	count: number;
}

export function getDecisionPercentiles(guildId: string, range: ResolvedRange): DecisionPercentiles {
	const { startS, endS } = rangeBounds(range);
	const rows = db()
		.prepare(
			`SELECT d.decision_time_s
			FROM (
				SELECT
					a.app_id,
					a.created_at_s - COALESCE(
						(SELECT MIN(c.created_at_s) FROM action_log c
						 WHERE c.app_id = a.app_id AND c.action = 'claim'),
						a.created_at_s
					) as decision_time_s
				FROM action_log a
				WHERE a.guild_id = ?
					AND a.action IN ('approve', 'reject', 'perm_reject', 'kick')
					AND (? = 0 OR a.created_at_s >= ?) AND a.created_at_s < ?
			) d
			WHERE d.decision_time_s > 0
			ORDER BY d.decision_time_s ASC`
		)
		.all(guildId, startS, startS, endS) as Array<{ decision_time_s: number }>;

	const count = rows.length;
	if (count === 0) return { p50: null, p75: null, p95: null, count: 0 };

	const p = (pct: number) => rows[Math.min(Math.floor(count * pct), count - 1)].decision_time_s;

	return {
		p50: Math.round(p(0.5)),
		p75: Math.round(p(0.75)),
		p95: Math.round(p(0.95)),
		count
	};
}

// ---------------------------------------------------------------------------
// Invite Source Analytics
// ---------------------------------------------------------------------------

export interface InviteSourceStat {
	code: string;
	label: string | null;
	inviterId: string | null;
	count: number;
}

export function getInviteSourceBreakdown(
	guildId: string,
	range: ResolvedRange
): InviteSourceStat[] {
	const { startS, endS } = rangeBounds(range);
	return db()
		.prepare(
			`SELECT
				COALESCE(u.invite_code, 'unknown') as code,
				il.label,
				u.inviter_id,
				COUNT(*) as count
			FROM invite_usage u
			LEFT JOIN invite_label il ON il.guild_id = u.guild_id AND il.invite_code = u.invite_code
			WHERE u.guild_id = ?
				AND (? = 0 OR u.joined_at_s >= ?) AND u.joined_at_s < ?
			GROUP BY u.invite_code
			ORDER BY count DESC
			LIMIT 20`
		)
		.all(guildId, startS, startS, endS) as InviteSourceStat[];
}

// ---------------------------------------------------------------------------
// Application Funnel Metrics
// ---------------------------------------------------------------------------

export interface FunnelMetrics {
	drafts: number;
	submitted: number;
	approved: number;
	rejected: number;
	kicked: number;
	permRejected: number;
	reapplications: number;
}

export function getApplicationFunnel(guildId: string, range: ResolvedRange): FunnelMetrics {
	const { startS, endS } = rangeBounds(range);
	const row = db()
		.prepare(
			`SELECT
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
				SUM(CASE WHEN status IN ('submitted', 'needs_info', 'approved', 'rejected', 'kicked', 'perm_rejected') THEN 1 ELSE 0 END) as submitted,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				SUM(CASE WHEN status = 'kicked' THEN 1 ELSE 0 END) as kicked,
				SUM(CASE WHEN status = 'perm_rejected' THEN 1 ELSE 0 END) as perm_rejected
			FROM application
			WHERE guild_id = ?
				AND (? = 0 OR created_at >= datetime(?, 'unixepoch'))
				AND created_at < datetime(?, 'unixepoch')`
		)
		.get(guildId, startS, startS, endS) as {
		drafts: number;
		submitted: number;
		approved: number;
		rejected: number;
		kicked: number;
		perm_rejected: number;
	} | undefined;

	const reapps = db()
		.prepare(
			`SELECT COUNT(DISTINCT user_id) as count
			FROM application
			WHERE guild_id = ?
				AND (? = 0 OR created_at >= datetime(?, 'unixepoch'))
				AND created_at < datetime(?, 'unixepoch')
			GROUP BY user_id
			HAVING COUNT(*) > 1`
		)
		.all(guildId, startS, startS, endS) as Array<{ count: number }>;

	return {
		drafts: row?.drafts ?? 0,
		submitted: row?.submitted ?? 0,
		approved: row?.approved ?? 0,
		rejected: row?.rejected ?? 0,
		kicked: row?.kicked ?? 0,
		permRejected: row?.perm_rejected ?? 0,
		reapplications: reapps.length
	};
}
