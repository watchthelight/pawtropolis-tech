import { db } from '$lib/server/db';

export interface HomeMetrics {
	pending: number;
	activeClaims: number;
	decisionsToday: number;
	openModmail: number | null;
	activeFlags: number | null;
}

const pendingStmt = db.prepare(
	'SELECT COUNT(*) as count FROM application WHERE guild_id = ? AND status IN (?, ?)'
);

const claimsStmt = db.prepare(
	'SELECT COUNT(*) as count FROM review_claim WHERE reviewer_id = ?'
);

const decisionsStmt = db.prepare(
	`SELECT COUNT(*) as count FROM review_action
	 WHERE moderator_id = ? AND action IN ('approve', 'reject', 'kick') AND created_at >= ?`
);

const modmailStmt = db.prepare(
	"SELECT COUNT(*) as count FROM modmail_ticket WHERE guild_id = ? AND status = 'open'"
);

const flagsStmt = db.prepare(
	'SELECT COUNT(*) as count FROM nsfw_flags WHERE guild_id = ? AND reviewed = 0'
);

function getTodayMidnightUnix(): number {
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	return Math.floor(now.getTime() / 1000);
}

export function getHomeMetrics(
	userId: string,
	guildId: string,
	includeModTier: boolean
): HomeMetrics {
	const pending = (pendingStmt.get(guildId, 'submitted', 'needs_info') as { count: number }).count;
	const activeClaims = (claimsStmt.get(userId) as { count: number }).count;
	const decisionsToday = (decisionsStmt.get(userId, getTodayMidnightUnix()) as { count: number }).count;

	let openModmail: number | null = null;
	let activeFlags: number | null = null;

	if (includeModTier) {
		openModmail = (modmailStmt.get(guildId) as { count: number }).count;
		activeFlags = (flagsStmt.get(guildId) as { count: number }).count;
	}

	return { pending, activeClaims, decisionsToday, openModmail, activeFlags };
}
