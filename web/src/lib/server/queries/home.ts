import { db } from '$lib/server/db';

export interface HomeMetrics {
	pending: number;
	pendingYours: number;
	activeClaims: number;
	decisionsToday: number;
	openModmail: number | null;
	activeFlags: number | null;
}

function getTodayMidnightUnix(): number {
	const now = new Date();
	return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

function count(sql: string, ...params: unknown[]): number {
	return (db().prepare(sql).get(...params) as { count: number }).count;
}

export function getHomeMetrics(
	userId: string,
	guildId: string,
	includeModTier: boolean
): HomeMetrics {
	const pending = count(
		'SELECT COUNT(*) as count FROM application WHERE guild_id = ? AND status IN (?, ?)',
		guildId, 'submitted', 'needs_info'
	);
	const pendingYours = count(
		`SELECT COUNT(*) as count FROM review_claim rc
		 JOIN application a ON rc.app_id = a.id
		 WHERE rc.reviewer_id = ? AND a.guild_id = ? AND a.status IN ('submitted', 'needs_info')`,
		userId, guildId
	);
	const activeClaims = count(
		'SELECT COUNT(*) as count FROM review_claim WHERE reviewer_id = ?',
		userId
	);
	const decisionsToday = count(
		`SELECT COUNT(*) as count FROM review_action
		 WHERE moderator_id = ? AND action IN ('approve', 'reject', 'kick') AND created_at >= ?`,
		userId, getTodayMidnightUnix()
	);

	let openModmail: number | null = null;
	let activeFlags: number | null = null;

	if (includeModTier) {
		openModmail = count(
			"SELECT COUNT(*) as count FROM modmail_ticket WHERE guild_id = ? AND status = 'open'",
			guildId
		);
		activeFlags = count(
			'SELECT COUNT(*) as count FROM nsfw_flags WHERE guild_id = ? AND reviewed = 0',
			guildId
		);
	}

	return { pending, pendingYours, activeClaims, decisionsToday, openModmail, activeFlags };
}
