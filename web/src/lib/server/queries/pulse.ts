import { db } from '$lib/server/db';

export interface PulseMetrics {
	pendingApps: number;
	openModmail: number;
	latestModmailAt: string | null;
	activeFlags: number;
	behavioralFlags: number;
	decisionsToday: number;
	submittedToday: number;
	messagesToday: number;
	messagesAvg7d: number;
	hourlyDistribution: number[];
	totalMembers: number;
	estimatedBots: number;
	estimatedRealUsers: number;
	activeRealUsers: number;
}

function count(sql: string, ...params: unknown[]): number {
	return (db().prepare(sql).get(...params) as { count: number }).count;
}

/**
 * Server-wide pulse metrics for the M+ dashboard.
 * Aggregates pending apps, open modmail, NSFW flags, and today's decision count.
 */
export function getPulseMetrics(guildId: string): PulseMetrics {
	// Compute UTC midnight once — used by decisionsToday (epoch seconds) and submittedToday (ISO text)
	const now = new Date();
	const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const todayMidnightS = Math.floor(midnight.getTime() / 1000);
	const todayMidnightISO = midnight.toISOString().slice(0, 19).replace('T', ' ');

	const pendingApps = count(
		"SELECT COUNT(*) as count FROM application WHERE guild_id = ? AND status IN ('submitted', 'needs_info')",
		guildId
	);

	const openModmail = count(
		"SELECT COUNT(*) as count FROM modmail_ticket WHERE guild_id = ? AND status = 'open'",
		guildId
	);

	const latestModmail = db().prepare(
		"SELECT created_at FROM modmail_ticket WHERE guild_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1"
	).get(guildId) as { created_at: string } | undefined;
	const latestModmailAt = latestModmail?.created_at ?? null;

	const activeFlags = count(
		'SELECT COUNT(*) as count FROM nsfw_flags WHERE guild_id = ? AND reviewed = 0',
		guildId
	);

	const behavioralFlags = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND flagged_at IS NOT NULL',
		guildId
	);

	const decisionsToday = count(
		`SELECT COUNT(*) as count FROM action_log
		 WHERE guild_id = ? AND action IN ('approve', 'reject', 'perm_reject', 'kick')
		 AND created_at_s >= ?`,
		guildId,
		todayMidnightS
	);

	const submittedToday = count(
		'SELECT COUNT(*) as count FROM application WHERE guild_id = ? AND created_at >= ?',
		guildId,
		todayMidnightISO
	);

	// Hourly message distribution for today — uses (guild_id, hour_bucket) index
	const hourlyRows = db().prepare(
		`SELECT hour_bucket, COUNT(*) as count
		 FROM message_activity
		 WHERE guild_id = ? AND hour_bucket >= ? AND hour_bucket < ?
		 GROUP BY hour_bucket
		 ORDER BY hour_bucket`
	).all(guildId, todayMidnightS, todayMidnightS + 24 * 3600) as { hour_bucket: number; count: number }[];

	const hourlyDistribution = new Array(24).fill(0);
	for (const row of hourlyRows) {
		hourlyDistribution[(row.hour_bucket - todayMidnightS) / 3600] = row.count;
	}
	const messagesToday = hourlyDistribution.reduce((a, b) => a + b, 0);

	// 7-day average: total messages / distinct days with data (max 7 days lookback)
	const sevenDaysAgoS = todayMidnightS - 7 * 86400;
	const weekStats = db().prepare(
		`SELECT COUNT(*) as total, COUNT(DISTINCT(created_at_s / 86400)) as days
		 FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?`
	).get(guildId, sevenDaysAgoS, todayMidnightS) as { total: number; days: number };
	const messagesAvg7d = weekStats.days > 0 ? Math.round(weekStats.total / weekStats.days) : 0;

	// Member count estimates from user_activity (tracks all known guild members)
	const totalMembers = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ?',
		guildId
	);

	// Estimated bots: users tracked in user_activity with no first_message_at.
	// Using first_message_at IS NULL is fast (indexed column, no joins needed).
	// This is a conservative estimate — some real lurkers will be counted as bots.
	const estimatedBots = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND first_message_at IS NULL',
		guildId
	);

	const estimatedRealUsers = Math.max(0, totalMembers - estimatedBots);

	// Active real users: 100+ messages in the past 14 days.
	// Uses the (guild_id, created_at_s) index for the WHERE filter.
	const fourteenDaysAgoS = Math.floor(Date.now() / 1000) - 14 * 86400;
	const activeRealUsers = count(
		`SELECT COUNT(*) as count FROM (
			SELECT user_id FROM message_activity
			WHERE guild_id = ? AND created_at_s >= ?
			GROUP BY user_id
			HAVING COUNT(*) >= 100
		)`,
		guildId,
		fourteenDaysAgoS
	);

	return { pendingApps, openModmail, latestModmailAt, activeFlags, behavioralFlags, decisionsToday, submittedToday, messagesToday, messagesAvg7d, hourlyDistribution, totalMembers, estimatedBots, estimatedRealUsers, activeRealUsers };
}
