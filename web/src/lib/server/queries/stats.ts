import { db } from '$lib/server/db';

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

export interface StatsPageData {
	personal: PersonalStats;
	windowDays: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function windowStart(days: number): number {
	return Math.floor(Date.now() / 1000) - days * 86_400;
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
