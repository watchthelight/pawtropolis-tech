import { db } from '$lib/server/db';

export interface PulseMetrics {
	pendingApps: number;
	openModmail: number;
	activeFlags: number;
	decisionsToday: number;
	totalMembers: number;
	estimatedBots: number;
	estimatedRealUsers: number;
	activeRealUsers: number;
}

function count(sql: string, ...params: unknown[]): number {
	return (db().prepare(sql).get(...params) as { count: number }).count;
}

function getTodayMidnightS(): number {
	const now = new Date();
	return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

/**
 * Server-wide pulse metrics for the M+ dashboard.
 * Aggregates pending apps, open modmail, NSFW flags, and today's decision count.
 */
export function getPulseMetrics(guildId: string): PulseMetrics {
	const pendingApps = count(
		"SELECT COUNT(*) as count FROM application WHERE guild_id = ? AND status IN ('submitted', 'needs_info')",
		guildId
	);

	const openModmail = count(
		"SELECT COUNT(*) as count FROM modmail_ticket WHERE guild_id = ? AND status = 'open'",
		guildId
	);

	const activeFlags = count(
		'SELECT COUNT(*) as count FROM nsfw_flags WHERE guild_id = ? AND reviewed = 0',
		guildId
	);

	const decisionsToday = count(
		`SELECT COUNT(*) as count FROM action_log
		 WHERE guild_id = ? AND action IN ('approve', 'reject', 'perm_reject', 'kick')
		 AND created_at_s >= ?`,
		guildId,
		getTodayMidnightS()
	);

	// Member count estimates from user_activity (tracks all known guild members)
	const totalMembers = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ?',
		guildId
	);

	// Estimated bots: users with no first message and no activity in message_activity.
	// Mirrors the core signals from botDetection.ts (no activity = +2 score).
	const estimatedBots = count(
		`SELECT COUNT(*) as count FROM user_activity ua
		 WHERE ua.guild_id = ? AND ua.first_message_at IS NULL
		 AND NOT EXISTS (
			SELECT 1 FROM message_activity ma
			WHERE ma.guild_id = ua.guild_id AND ma.user_id = ua.user_id
		 )`,
		guildId
	);

	const estimatedRealUsers = Math.max(0, totalMembers - estimatedBots);

	// Active real users: 100+ messages in the past 14 days
	const fourteenDaysAgoS = Math.floor(Date.now() / 1000) - 14 * 86400;
	const activeRealUsers = count(
		`SELECT COUNT(*) as count FROM (
			SELECT user_id FROM message_activity
			WHERE guild_id = ? AND timestamp_s >= ?
			GROUP BY user_id
			HAVING COUNT(*) >= 100
		)`,
		guildId,
		fourteenDaysAgoS
	);

	return { pendingApps, openModmail, activeFlags, decisionsToday, totalMembers, estimatedBots, estimatedRealUsers, activeRealUsers };
}
