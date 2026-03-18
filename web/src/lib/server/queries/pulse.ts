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
	allTimeMembers: number;
	membersLeft: number;
	estimatedBots: number;
	estimatedRealUsers: number;
	activeRealUsers: number;
}

function count(sql: string, ...params: unknown[]): number {
	return (db().prepare(sql).get(...params) as { count: number }).count;
}

/** SSR-safe number formatting — avoids locale-dependent toLocaleString() on the server */
function fmt(n: number): string {
	return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

	// Member counts
	const allTimeMembers = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ?',
		guildId
	);
	const membersLeft = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND left_at IS NOT NULL',
		guildId
	);
	const totalMembers = allTimeMembers - membersLeft;

	// Estimated bots: current members with no first_message_at.
	const estimatedBots = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND first_message_at IS NULL AND left_at IS NULL',
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

	return { pendingApps, openModmail, latestModmailAt, activeFlags, behavioralFlags, decisionsToday, submittedToday, messagesToday, messagesAvg7d, hourlyDistribution, totalMembers, allTimeMembers, membersLeft, estimatedBots, estimatedRealUsers, activeRealUsers };
}

// ─── Newsletter Stats ──────────────────────────────────────────────────────────

export interface WeekStats {
	newMembers: number;
	retentionPct: number;
	newCommunicators: number;
	communicators: number;
	totalMessages: number;
	voiceMinutes: number;
}

export interface NewsletterStats {
	current: WeekStats;
	previous: WeekStats;
	voiceTrackingActive: boolean; // true if voice_session has any rows
}

function weekStats(guildId: string, from: number, to: number): WeekStats {
	const d = db();

	const newMembers = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?',
		guildId, from, to
	);

	const retention = d.prepare(
		`SELECT
			COUNT(CASE WHEN first_message_at IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as pct
		 FROM user_activity
		 WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?`
	).get(guildId, from, to) as { pct: number | null };
	const retentionPct = retention.pct ?? 0;

	const newCommunicators = count(
		`SELECT COUNT(*) as count FROM user_activity
		 WHERE guild_id = ? AND joined_at >= ? AND joined_at < ? AND first_message_at IS NOT NULL`,
		guildId, from, to
	);

	const communicators = count(
		'SELECT COUNT(DISTINCT user_id) as count FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?',
		guildId, from, to
	);

	const totalMessages = count(
		'SELECT COUNT(*) as count FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?',
		guildId, from, to
	);

	// Voice minutes — includes still-in-voice sessions (counts up to `to` boundary)
	const voiceResult = d.prepare(
		`SELECT COALESCE(SUM(
			CASE
				WHEN left_at_s IS NOT NULL THEN left_at_s - joined_at_s
				ELSE ? - joined_at_s
			END
		) / 60, 0) as minutes
		FROM voice_session
		WHERE guild_id = ? AND joined_at_s >= ? AND joined_at_s < ?`
	).get(to, guildId, from, to) as { minutes: number };
	const voiceMinutes = voiceResult.minutes;

	return { newMembers, retentionPct, newCommunicators, communicators, totalMessages, voiceMinutes };
}

/**
 * Newsletter shows the LAST COMPLETED week (Mon-Sun) vs the week before that.
 * "Current" = last full Mon 00:00 UTC → Sun 23:59 UTC.
 * "Previous" = the week before that.
 * This matches Discord Server Insights and ensures the newsletter always reports a full week.
 */
export function getNewsletterStats(guildId: string): NewsletterStats {
	const now = new Date();
	const utcDay = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
	const daysSinceMonday = utcDay === 0 ? 6 : utcDay - 1;
	const thisMonday = new Date(Date.UTC(
		now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday
	));
	const thisMondayS = Math.floor(thisMonday.getTime() / 1000);

	// Last completed week: previous Monday → this Monday
	const lastWeekStart = thisMondayS - 7 * 86400;
	const lastWeekEnd = thisMondayS;
	// Week before that
	const prevWeekStart = thisMondayS - 14 * 86400;
	const prevWeekEnd = lastWeekStart;

	const voiceRows = (db().prepare('SELECT COUNT(*) as count FROM voice_session WHERE guild_id = ?').get(guildId) as { count: number }).count;

	return {
		current: weekStats(guildId, lastWeekStart, lastWeekEnd),
		previous: weekStats(guildId, prevWeekStart, prevWeekEnd),
		voiceTrackingActive: voiceRows > 0
	};
}

// ─── Guild Snapshot ─────────────────────────────────────────────────────────

export interface GuildSnapshot {
	memberCount: number;
	onlineCount: number | null;
	boostCount: number;
	boostTier: number;
	channelCount: number;
	roleCount: number;
	voiceUsersNow: number;
	updatedAtS: number;
}

export function getGuildSnapshot(guildId: string): GuildSnapshot | null {
	const row = db().prepare('SELECT * FROM guild_snapshot WHERE guild_id = ?').get(guildId) as {
		member_count: number; online_count: number | null; boost_count: number;
		boost_tier: number; channel_count: number; role_count: number;
		voice_users_now: number; updated_at_s: number;
	} | undefined;

	if (!row) return null;
	return {
		memberCount: row.member_count,
		onlineCount: row.online_count,
		boostCount: row.boost_count,
		boostTier: row.boost_tier,
		channelCount: row.channel_count,
		roleCount: row.role_count,
		voiceUsersNow: row.voice_users_now,
		updatedAtS: row.updated_at_s
	};
}

// ─── Top Voice Channels ─────────────────────────────────────────────────────

export interface TopVoiceChannel {
	channelId: string;
	channelName: string | null;
	minutes: number;
}

export function getTopVoiceChannels(guildId: string): TopVoiceChannel[] {
	const nowS = Math.floor(Date.now() / 1000);
	const weekStart = nowS - 7 * 86400;

	return db().prepare(`
		SELECT vs.channel_id as channelId, cc.name as channelName,
			SUM(CASE WHEN vs.left_at_s IS NOT NULL THEN vs.left_at_s - vs.joined_at_s ELSE ? - vs.joined_at_s END) / 60 as minutes
		FROM voice_session vs
		LEFT JOIN channel_cache cc ON vs.guild_id = cc.guild_id AND vs.channel_id = cc.channel_id
		WHERE vs.guild_id = ? AND vs.joined_at_s >= ? AND vs.joined_at_s < ?
		GROUP BY vs.channel_id ORDER BY minutes DESC LIMIT 3
	`).all(nowS, guildId, weekStart, nowS) as TopVoiceChannel[];
}

// ─── Insights Engine ────────────────────────────────────────────────────────────

export interface Insight {
	id: string;
	category: 'growth' | 'engagement' | 'moderation' | 'risk' | 'retention';
	severity: 'info' | 'warning' | 'critical';
	title: string;
	body: string;
	metric?: string;
	trend?: 'up' | 'down' | 'flat';
	suggestion?: string;
}

type InsightDetector = (guildId: string, nowS: number) => Insight | null;

// ── Growth & Retention ──

function detectJoinVelocity(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const fourWeeksAgo = nowS - 28 * 86400;

	const thisWeek = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?',
		guildId, weekStart, nowS
	);
	const fourWeekAvg = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?',
		guildId, fourWeeksAgo, nowS
	) / 4;

	if (fourWeekAvg === 0) return null;
	const pctDiff = ((thisWeek - fourWeekAvg) / fourWeekAvg) * 100;
	if (Math.abs(pctDiff) < 30) return null;

	const spike = pctDiff > 0;
	return {
		id: 'join-velocity',
		category: 'growth',
		severity: Math.abs(pctDiff) > 60 ? 'warning' : 'info',
		title: spike ? 'Join velocity spike' : 'Join velocity drop',
		body: spike
			? `${thisWeek} joins this week — ${Math.round(pctDiff)}% above the 4-week average of ${Math.round(fourWeekAvg)}.`
			: `Only ${thisWeek} joins this week — ${Math.round(Math.abs(pctDiff))}% below the 4-week average of ${Math.round(fourWeekAvg)}.`,
		metric: fmt(thisWeek),
		trend: spike ? 'up' : 'down',
		suggestion: spike ? 'Check if a raid or external promotion is driving the spike.' : 'Consider outreach or community events to boost visibility.'
	};
}

function detectRetentionCliff(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const prevStart = nowS - 14 * 86400;
	const d = db();

	const currentRet = d.prepare(
		`SELECT COUNT(CASE WHEN first_message_at IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as pct
		 FROM user_activity WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?`
	).get(guildId, weekStart, nowS) as { pct: number | null };

	const prevRet = d.prepare(
		`SELECT COUNT(CASE WHEN first_message_at IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as pct
		 FROM user_activity WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?`
	).get(guildId, prevStart, weekStart) as { pct: number | null };

	const cur = currentRet.pct ?? 0;
	const prev = prevRet.pct ?? 0;

	if (cur < 20 || (prev > 0 && prev - cur > 10)) {
		return {
			id: 'retention-cliff',
			category: 'retention',
			severity: cur < 10 ? 'critical' : 'warning',
			title: 'New member retention dropping',
			body: cur < 20
				? `Only ${cur.toFixed(1)}% of new members this week sent a message — below the 20% threshold.`
				: `Retention fell ${(prev - cur).toFixed(1)} percentage points from ${prev.toFixed(1)}% to ${cur.toFixed(1)}%.`,
			metric: `${cur.toFixed(1)}%`,
			trend: 'down',
			suggestion: 'Review the onboarding flow — are new members finding channels and conversations easily?'
		};
	}
	return null;
}

function detectLeaveSpike(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const fourWeeksAgo = nowS - 28 * 86400;

	// Guard: need at least 2 weeks of leave data to compare meaningfully
	const priorWeeks = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND left_at >= ? AND left_at < ?',
		guildId, fourWeeksAgo, weekStart
	);
	if (priorWeeks === 0) return null; // tracking just started — no baseline

	const thisWeek = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND left_at >= ? AND left_at < ?',
		guildId, weekStart, nowS
	);
	const fourWeekAvg = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND left_at >= ? AND left_at < ?',
		guildId, fourWeeksAgo, nowS
	) / 4;

	if (fourWeekAvg === 0 || thisWeek < fourWeekAvg * 2) return null;

	return {
		id: 'leave-spike',
		category: 'growth',
		severity: 'critical',
		title: 'Member departure surge',
		body: `${thisWeek} members left this week — ${(thisWeek / fourWeekAvg).toFixed(1)}x the 4-week average of ${Math.round(fourWeekAvg)}.`,
		metric: fmt(thisWeek),
		trend: 'up',
		suggestion: 'Investigate recent events — server changes, conflicts, or moderation actions that may be driving departures.'
	};
}

function detectGhostRatio(guildId: string, nowS: number): Insight | null {
	const thirtyDaysAgo = nowS - 30 * 86400;

	const total = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND joined_at >= ?',
		guildId, thirtyDaysAgo
	);
	if (total === 0) return null;

	const ghosts = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND joined_at >= ? AND first_message_at IS NULL',
		guildId, thirtyDaysAgo
	);

	const pct = (ghosts / total) * 100;
	if (pct < 75) return null;

	return {
		id: 'ghost-ratio',
		category: 'retention',
		severity: pct > 90 ? 'critical' : 'warning',
		title: 'High ghost member ratio',
		body: `${pct.toFixed(1)}% of members who joined in the last 30 days (${ghosts}/${total}) never sent a message.`,
		metric: `${pct.toFixed(1)}%`,
		trend: 'up',
		suggestion: 'Consider a welcome ping, starter prompts, or a guided intro channel to break the ice.'
	};
}

// ── Engagement ──

function detectMessageAnomaly(guildId: string, nowS: number): Insight | null {
	const d = db();
	const nowDate = new Date(nowS * 1000);
	const currentHour = nowDate.getUTCHours();

	// Normalize today's count to per-hour rate up to the current hour
	const todayMidnightS = nowS - (nowS % 86400); // approximate UTC midnight
	const todayCount = count(
		'SELECT COUNT(*) as count FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?',
		guildId, todayMidnightS, nowS
	);
	if (currentHour === 0) return null;
	const todayRate = todayCount / currentHour;

	// Collect same-day-of-week rates for the past 4 weeks
	const rates: number[] = [];
	for (let w = 1; w <= 4; w++) {
		const dayStart = todayMidnightS - w * 7 * 86400;
		const dayEnd = dayStart + currentHour * 3600;
		const cnt = count(
			'SELECT COUNT(*) as count FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?',
			guildId, dayStart, dayEnd
		);
		if (currentHour > 0) rates.push(cnt / currentHour);
	}

	if (rates.length < 2) return null;
	const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
	const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
	const stdDev = Math.sqrt(variance);

	if (stdDev === 0) return null;
	const zScore = (todayRate - mean) / stdDev;
	if (Math.abs(zScore) < 2) return null;

	const high = zScore > 0;
	return {
		id: 'message-anomaly',
		category: 'engagement',
		severity: Math.abs(zScore) > 3 ? 'warning' : 'info',
		title: high ? 'Unusually high message volume' : 'Unusually low message volume',
		body: `Today's hourly message rate (${Math.round(todayRate)}/hr) is ${Math.abs(zScore).toFixed(1)} standard deviations ${high ? 'above' : 'below'} the same-day average.`,
		metric: `${fmt(todayCount)} msgs`,
		trend: high ? 'up' : 'down'
	};
}

function detectChannelConcentration(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const d = db();

	const top = d.prepare(
		`SELECT ma.channel_id, cc.name as channel_name, COUNT(*) as cnt,
			COUNT(*) * 100.0 / (SELECT COUNT(*) FROM message_activity WHERE guild_id = ? AND created_at_s >= ?) as pct
		 FROM message_activity ma
		 LEFT JOIN channel_cache cc ON ma.guild_id = cc.guild_id AND ma.channel_id = cc.channel_id
		 WHERE ma.guild_id = ? AND ma.created_at_s >= ?
		 GROUP BY ma.channel_id ORDER BY cnt DESC LIMIT 1`
	).get(guildId, weekStart, guildId, weekStart) as { channel_id: string; channel_name: string | null; cnt: number; pct: number } | undefined;

	if (!top || top.pct < 60) return null;

	const channelLabel = top.channel_name ? `#${top.channel_name}` : top.channel_id;
	return {
		id: 'channel-concentration',
		category: 'engagement',
		severity: top.pct > 80 ? 'warning' : 'info',
		title: 'Conversation concentrated in one channel',
		body: `${top.pct.toFixed(1)}% of this week's messages (${fmt(top.cnt)}) are in ${channelLabel}.`,
		metric: `${top.pct.toFixed(1)}%`,
		trend: 'flat',
		suggestion: 'Consider whether this is healthy engagement or spam. Diversifying conversation across channels improves resilience.'
	};
}

function detectCommunicatorRatioDecline(guildId: string, nowS: number): Insight | null {
	const d = db();
	const ratios: number[] = [];

	// Get communicator ratio for each of the last 4 weeks
	for (let w = 0; w < 4; w++) {
		const wEnd = nowS - w * 7 * 86400;
		const wStart = wEnd - 7 * 86400;

		const communicators = count(
			'SELECT COUNT(DISTINCT user_id) as count FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?',
			guildId, wStart, wEnd
		);
		// Total members at that time: joined before wEnd and not left before wEnd
		const members = count(
			'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND joined_at < ? AND (left_at IS NULL OR left_at >= ?)',
			guildId, wEnd, wStart
		);
		if (members > 0) ratios.push(communicators / members);
	}

	if (ratios.length < 3) return null;

	// Check for 3+ consecutive weeks of decline (ratios[0] is most recent)
	let declining = true;
	for (let i = 0; i < ratios.length - 1; i++) {
		if (ratios[i] >= ratios[i + 1]) { declining = false; break; }
	}

	if (!declining) return null;

	const currentPct = (ratios[0] * 100).toFixed(1);
	return {
		id: 'communicator-ratio-decline',
		category: 'engagement',
		severity: 'warning',
		title: 'Engagement density declining',
		body: `The ratio of active communicators to total members has decreased for ${ratios.length} consecutive weeks. Currently ${currentPct}%.`,
		metric: `${currentPct}%`,
		trend: 'down',
		suggestion: 'Server activity is becoming more passive. Consider engagement events, topic prompts, or reducing lurker friction.'
	};
}

function detectVoiceTrend(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const prevStart = nowS - 14 * 86400;
	const d = db();

	// Total voice minutes this week vs last (include still-in-voice sessions)
	const voiceQuery = `
		SELECT COALESCE(SUM(
			CASE WHEN left_at_s IS NOT NULL THEN left_at_s - joined_at_s ELSE ? - joined_at_s END
		) / 60, 0) as minutes
		FROM voice_session WHERE guild_id = ? AND joined_at_s >= ? AND joined_at_s < ?`;

	const thisWeek = (d.prepare(voiceQuery).get(nowS, guildId, weekStart, nowS) as { minutes: number }).minutes;
	const prevWeek = (d.prepare(voiceQuery).get(weekStart, guildId, prevStart, weekStart) as { minutes: number }).minutes;

	// Check for shallow engagement: few users, many hours
	const voiceUsersThisWeek = count(
		'SELECT COUNT(DISTINCT user_id) as count FROM voice_session WHERE guild_id = ? AND joined_at_s >= ? AND joined_at_s < ?',
		guildId, weekStart, nowS
	);
	const communicatorsThisWeek = count(
		'SELECT COUNT(DISTINCT user_id) as count FROM message_activity WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ?',
		guildId, weekStart, nowS
	);

	// Shallow engagement: voice is active but <5% of communicators are using it
	if (thisWeek > 0 && communicatorsThisWeek > 0 && voiceUsersThisWeek < communicatorsThisWeek * 0.05) {
		return {
			id: 'voice-shallow',
			category: 'engagement',
			severity: 'info',
			title: 'Voice engagement is shallow',
			body: `Only ${voiceUsersThisWeek} user${voiceUsersThisWeek === 1 ? '' : 's'} used voice this week (${((voiceUsersThisWeek / communicatorsThisWeek) * 100).toFixed(1)}% of communicators) but logged ${fmt(thisWeek)} minutes.`,
			metric: `${voiceUsersThisWeek} users`,
			trend: 'flat',
			suggestion: 'A small group is camping voice channels. Consider voice events or activities to broaden participation.'
		};
	}

	// Volume trend: compare this week to last
	if (prevWeek === 0 && thisWeek === 0) return null;

	if (prevWeek > 0) {
		const pctChange = ((thisWeek - prevWeek) / prevWeek) * 100;

		if (pctChange < -30) {
			return {
				id: 'voice-trend',
				category: 'engagement',
				severity: 'warning',
				title: 'Voice activity dropping',
				body: `${fmt(thisWeek)} voice minutes this week — down ${Math.abs(pctChange).toFixed(0)}% from last week's ${fmt(prevWeek)}.`,
				metric: `${fmt(thisWeek)} min`,
				trend: 'down',
				suggestion: 'Consider hosting a voice event, game night, or movie night to re-engage the community.'
			};
		}

		if (pctChange > 50) {
			return {
				id: 'voice-trend',
				category: 'engagement',
				severity: 'info',
				title: 'Voice activity surging',
				body: `${fmt(thisWeek)} voice minutes this week — up ${pctChange.toFixed(0)}% from last week's ${fmt(prevWeek)}.`,
				metric: `${fmt(thisWeek)} min`,
				trend: 'up'
			};
		}
	}

	return null;
}

// ── Moderation ──

function detectAppBacklog(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;

	const pending = count(
		"SELECT COUNT(*) as count FROM application WHERE guild_id = ? AND status IN ('submitted', 'needs_info')",
		guildId
	);

	const reviewsThisWeek = count(
		`SELECT COUNT(*) as count FROM review_action
		 WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)
		 AND action IN ('approve', 'reject', 'perm_reject', 'kick')
		 AND created_at >= ?`,
		guildId, weekStart
	);

	const dailyRate = reviewsThisWeek / 7;
	if (dailyRate === 0 && pending === 0) return null;
	if (dailyRate > 0 && pending <= dailyRate * 2) return null;

	return {
		id: 'app-backlog',
		category: 'moderation',
		severity: pending > dailyRate * 5 || (dailyRate === 0 && pending > 0) ? 'critical' : 'warning',
		title: 'Application backlog growing',
		body: dailyRate === 0
			? `${pending} applications pending with no reviews in the past week.`
			: `${pending} applications pending — review rate is ${dailyRate.toFixed(1)}/day, which would take ${Math.ceil(pending / dailyRate)} days to clear.`,
		metric: fmt(pending),
		trend: 'up',
		suggestion: 'Rally the mod team or consider a review sprint to clear the queue.'
	};
}

function detectModWorkloadImbalance(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const d = db();

	const rows = d.prepare(
		`SELECT moderator_id, COUNT(*) as reviews,
			COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0) as pct
		 FROM review_action
		 WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)
		   AND action IN ('approve', 'reject', 'perm_reject', 'kick')
		   AND created_at >= ?
		 GROUP BY moderator_id`
	).all(guildId, weekStart) as { moderator_id: string; reviews: number; pct: number }[];

	if (rows.length === 0) return null;

	const topMod = rows.reduce((a, b) => a.pct > b.pct ? a : b);
	if (topMod.pct < 40) return null;

	return {
		id: 'mod-workload-imbalance',
		category: 'moderation',
		severity: topMod.pct > 60 ? 'warning' : 'info',
		title: 'Moderator workload imbalance',
		body: `One moderator handled ${topMod.pct.toFixed(1)}% of all reviews this week (${topMod.reviews} of ${rows.reduce((a, b) => a + b.reviews, 0)}).`,
		metric: `${topMod.pct.toFixed(1)}%`,
		trend: 'flat',
		suggestion: 'Consider distributing reviews more evenly to prevent burnout.'
	};
}

function detectRejectionRateShift(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const fourWeeksAgo = nowS - 28 * 86400;
	const d = db();

	const thisWeek = d.prepare(
		`SELECT
			COUNT(CASE WHEN action IN ('approve') THEN 1 END) as approvals,
			COUNT(CASE WHEN action IN ('reject', 'perm_reject', 'kick') THEN 1 END) as rejections
		 FROM review_action
		 WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)
		   AND action IN ('approve', 'reject', 'perm_reject', 'kick')
		   AND created_at >= ?`
	).get(guildId, weekStart) as { approvals: number; rejections: number };

	const fourWeek = d.prepare(
		`SELECT
			COUNT(CASE WHEN action IN ('approve') THEN 1 END) as approvals,
			COUNT(CASE WHEN action IN ('reject', 'perm_reject', 'kick') THEN 1 END) as rejections
		 FROM review_action
		 WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)
		   AND action IN ('approve', 'reject', 'perm_reject', 'kick')
		   AND created_at >= ? AND created_at < ?`
	).get(guildId, fourWeeksAgo, weekStart) as { approvals: number; rejections: number };

	const totalThis = thisWeek.approvals + thisWeek.rejections;
	const totalFour = fourWeek.approvals + fourWeek.rejections;
	if (totalThis === 0 || totalFour === 0) return null;

	const thisRate = (thisWeek.rejections / totalThis) * 100;
	const fourRate = (fourWeek.rejections / totalFour) * 100;
	const diff = thisRate - fourRate;

	if (Math.abs(diff) < 15) return null;

	const higher = diff > 0;
	return {
		id: 'rejection-rate-shift',
		category: 'moderation',
		severity: Math.abs(diff) > 30 ? 'warning' : 'info',
		title: higher ? 'Rejection rate up' : 'Rejection rate down',
		body: `Rejection rate this week is ${thisRate.toFixed(1)}% vs ${fourRate.toFixed(1)}% average — a ${Math.abs(diff).toFixed(1)}pp ${higher ? 'increase' : 'decrease'}.`,
		metric: `${thisRate.toFixed(1)}%`,
		trend: higher ? 'up' : 'down',
		suggestion: higher
			? 'Investigate whether this reflects a raid, stricter enforcement, or a change in applicant quality.'
			: 'Lower rejection rates could mean better applicants or looser standards — verify quality is maintained.'
	};
}

function detectModmailResponseTime(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const prevStart = nowS - 14 * 86400;
	const d = db();

	// Average time to first staff reply (direction='to_user') for tickets this week vs last
	const avgQuery = `
		SELECT AVG(reply_delay) as avg_delay FROM (
			SELECT MIN(strftime('%s', mm.created_at) - strftime('%s', mt.created_at)) as reply_delay
			FROM modmail_ticket mt
			JOIN modmail_message mm ON mm.ticket_id = mt.id AND mm.direction = 'to_user'
			WHERE mt.guild_id = ? AND strftime('%s', mt.created_at) >= ? AND strftime('%s', mt.created_at) < ?
			GROUP BY mt.id
		)`;

	const thisWeek = d.prepare(avgQuery).get(guildId, weekStart, nowS) as { avg_delay: number | null };
	const prevWeek = d.prepare(avgQuery).get(guildId, prevStart, weekStart) as { avg_delay: number | null };

	if (!thisWeek.avg_delay || !prevWeek.avg_delay || prevWeek.avg_delay === 0) return null;

	const pctChange = ((thisWeek.avg_delay - prevWeek.avg_delay) / prevWeek.avg_delay) * 100;
	if (pctChange < 50) return null;

	const hours = (thisWeek.avg_delay / 3600).toFixed(1);
	return {
		id: 'modmail-response-time',
		category: 'moderation',
		severity: pctChange > 100 ? 'warning' : 'info',
		title: 'Modmail response time increasing',
		body: `Average first reply is ${hours}h — ${pctChange.toFixed(0)}% slower than last week.`,
		metric: `${hours}h`,
		trend: 'up',
		suggestion: 'Assign modmail duty shifts or set up notifications so tickets get faster first responses.'
	};
}

// ── Risk ──

function detectNsfwFlagSurge(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const prevStart = nowS - 14 * 86400;

	// nsfw_flags.flagged_at is ISO text — use strftime to compare
	const thisWeek = count(
		"SELECT COUNT(*) as count FROM nsfw_flags WHERE guild_id = ? AND strftime('%s', flagged_at) >= ? AND strftime('%s', flagged_at) < ?",
		guildId, String(weekStart), String(nowS)
	);
	const prevWeek = count(
		"SELECT COUNT(*) as count FROM nsfw_flags WHERE guild_id = ? AND strftime('%s', flagged_at) >= ? AND strftime('%s', flagged_at) < ?",
		guildId, String(prevStart), String(weekStart)
	);

	if (prevWeek === 0 || thisWeek < prevWeek * 2) return null;

	return {
		id: 'nsfw-flag-surge',
		category: 'risk',
		severity: 'critical',
		title: 'NSFW flag surge',
		body: `${thisWeek} avatar flags this week — ${(thisWeek / prevWeek).toFixed(1)}x last week's ${prevWeek}.`,
		metric: fmt(thisWeek),
		trend: 'up',
		suggestion: 'Check for coordinated bad actors or a raid. Review the flags queue immediately.'
	};
}

function detectBehavioralFlagCluster(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const d = db();

	// user_activity.flagged_at is INTEGER (unix seconds)
	const rows = d.prepare(
		`SELECT flagged_at / 86400 as day_bucket, COUNT(*) as cnt
		 FROM user_activity
		 WHERE guild_id = ? AND flagged_at >= ? AND flagged_at < ?
		 GROUP BY day_bucket
		 HAVING cnt > 5
		 ORDER BY cnt DESC
		 LIMIT 1`
	).all(guildId, weekStart, nowS) as { day_bucket: number; cnt: number }[];

	if (rows.length === 0) return null;

	const worst = rows[0];
	const date = new Date(worst.day_bucket * 86400 * 1000).toISOString().slice(0, 10);
	return {
		id: 'behavioral-flag-cluster',
		category: 'risk',
		severity: worst.cnt > 10 ? 'critical' : 'warning',
		title: 'Behavioral flag cluster',
		body: `${worst.cnt} users were flagged on ${date} — possible coordinated activity.`,
		metric: fmt(worst.cnt),
		trend: 'up',
		suggestion: 'Review the flagged accounts for shared patterns (similar names, join timing, avatar style).'
	};
}

function detectRapidJoinLeave(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;

	const rapidLeaves = count(
		`SELECT COUNT(*) as count FROM user_activity
		 WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?
		   AND left_at IS NOT NULL AND (left_at - joined_at) < 86400`,
		guildId, weekStart, nowS
	);

	const totalJoins = count(
		'SELECT COUNT(*) as count FROM user_activity WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?',
		guildId, weekStart, nowS
	);

	if (totalJoins === 0) return null;
	const pct = (rapidLeaves / totalJoins) * 100;
	if (pct < 10) return null;

	return {
		id: 'rapid-join-leave',
		category: 'risk',
		severity: pct > 25 ? 'critical' : 'warning',
		title: 'Rapid join-leave pattern',
		body: `${rapidLeaves} of ${totalJoins} new members (${pct.toFixed(1)}%) joined and left within 24 hours.`,
		metric: `${pct.toFixed(1)}%`,
		trend: 'up',
		suggestion: pct > 25
			? 'This pattern suggests a raid or automated joins. Consider enabling panic mode.'
			: 'Could indicate a poor first impression. Review the landing experience for new members.'
	};
}

// ── API-Enriched Insights ──

function detectGrowthSource(guildId: string, nowS: number): Insight | null {
	const weekStart = nowS - 7 * 86400;
	const d = db();

	const totalJoins = count(
		'SELECT COUNT(*) as count FROM invite_usage WHERE guild_id = ? AND joined_at_s >= ?',
		guildId, weekStart
	);
	if (totalJoins < 10) return null;

	const top = d.prepare(
		`SELECT invite_code, inviter_id, COUNT(*) as cnt,
			COUNT(*) * 100.0 / ? as pct
		 FROM invite_usage
		 WHERE guild_id = ? AND joined_at_s >= ? AND invite_code IS NOT NULL
		 GROUP BY invite_code ORDER BY cnt DESC LIMIT 1`
	).get(totalJoins, guildId, weekStart) as { invite_code: string; inviter_id: string | null; cnt: number; pct: number } | undefined;

	if (!top || top.pct < 50 || top.cnt < 10) return null;

	return {
		id: 'growth-source',
		category: 'growth',
		severity: top.pct > 75 ? 'warning' : 'info',
		title: 'Single invite driving most growth',
		body: `Invite \`${top.invite_code}\` accounts for ${top.pct.toFixed(1)}% of this week's joins (${top.cnt}/${totalJoins}).`,
		metric: `${top.pct.toFixed(1)}%`,
		trend: 'flat',
		suggestion: top.pct > 75
			? 'Heavy reliance on one invite source is risky. If that link goes down or gets flagged, growth stops.'
			: 'Monitor this invite source. If it\'s a listing site like Disboard, great. If unknown, verify it\'s not a raid link.'
	};
}

function detectBoostHealth(guildId: string, _nowS: number): Insight | null {
	const d = db();
	const today = new Date().toISOString().slice(0, 10);
	const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);

	const current = d.prepare('SELECT boost_count, boost_tier FROM guild_snapshot WHERE guild_id = ?')
		.get(guildId) as { boost_count: number; boost_tier: number } | undefined;
	if (!current) return null;

	const prev = d.prepare('SELECT boost_count, boost_tier FROM guild_snapshot_log WHERE guild_id = ? AND date <= ? ORDER BY date DESC LIMIT 1')
		.get(guildId, sevenDaysAgo) as { boost_count: number; boost_tier: number } | undefined;

	// Tier thresholds: Level 1=2, Level 2=7, Level 3=14
	const tierThresholds = [0, 2, 7, 14];
	const tier = current.boost_tier;
	const threshold = tierThresholds[tier] ?? 0;

	// At risk of dropping a tier
	if (tier > 0 && current.boost_count <= threshold + 1) {
		return {
			id: 'boost-health',
			category: 'growth',
			severity: current.boost_count <= threshold ? 'critical' : 'warning',
			title: `Boost Level ${tier} at risk`,
			body: `Only ${current.boost_count} boosts — Level ${tier} requires ${threshold}. ${current.boost_count <= threshold ? 'Server will lose perks!' : 'One unboost away from losing perks.'}`,
			metric: `${current.boost_count} boosts`,
			trend: 'down',
			suggestion: 'Remind the community about boost perks or consider a boost drive.'
		};
	}

	// Boost count dropping significantly
	if (prev && prev.boost_count > 0) {
		const drop = prev.boost_count - current.boost_count;
		if (drop >= 3) {
			return {
				id: 'boost-health',
				category: 'growth',
				severity: 'info',
				title: 'Boost count declining',
				body: `Lost ${drop} boosts this week (${prev.boost_count} → ${current.boost_count}).`,
				metric: `${current.boost_count} boosts`,
				trend: 'down'
			};
		}
	}

	return null;
}

function detectOnlineRatio(guildId: string, _nowS: number): Insight | null {
	const d = db();
	const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);

	const current = d.prepare('SELECT member_count, online_count FROM guild_snapshot WHERE guild_id = ?')
		.get(guildId) as { member_count: number; online_count: number | null } | undefined;
	if (!current || !current.online_count || current.member_count === 0) return null;

	const currentRatio = current.online_count / current.member_count;

	// Compare to 7-day average from snapshot log
	const avgRow = d.prepare(
		`SELECT AVG(CAST(online_count AS REAL) / NULLIF(member_count, 0)) as avg_ratio
		 FROM guild_snapshot_log WHERE guild_id = ? AND date >= ? AND online_count IS NOT NULL`
	).get(guildId, sevenDaysAgo) as { avg_ratio: number | null };

	if (!avgRow?.avg_ratio || avgRow.avg_ratio === 0) return null;

	const pctDiff = ((currentRatio - avgRow.avg_ratio) / avgRow.avg_ratio) * 100;

	if (pctDiff < -25) {
		return {
			id: 'online-ratio',
			category: 'engagement',
			severity: pctDiff < -40 ? 'warning' : 'info',
			title: 'Online ratio dropping',
			body: `${(currentRatio * 100).toFixed(1)}% of members are online — ${Math.abs(pctDiff).toFixed(0)}% below the 7-day average.`,
			metric: `${(currentRatio * 100).toFixed(1)}%`,
			trend: 'down',
			suggestion: 'Fewer members are coming online. This may indicate declining interest or a seasonal pattern.'
		};
	}

	return null;
}

// ── Collector ──

const detectors: InsightDetector[] = [
	detectJoinVelocity,
	detectRetentionCliff,
	detectLeaveSpike,
	detectGhostRatio,
	detectMessageAnomaly,
	detectChannelConcentration,
	detectCommunicatorRatioDecline,
	detectVoiceTrend,
	detectAppBacklog,
	detectModWorkloadImbalance,
	detectRejectionRateShift,
	detectModmailResponseTime,
	detectNsfwFlagSurge,
	detectBehavioralFlagCluster,
	detectRapidJoinLeave,
	detectGrowthSource,
	detectBoostHealth,
	detectOnlineRatio
];

export function getInsights(guildId: string): Insight[] {
	const nowS = Math.floor(Date.now() / 1000);
	const insights: Insight[] = [];

	for (const detect of detectors) {
		try {
			const insight = detect(guildId, nowS);
			if (insight) insights.push(insight);
		} catch (err) {
			// Individual detector failures shouldn't crash the whole insights panel
			console.warn(`[pulse] Insight detector ${detect.name} failed:`, err);
		}
	}

	// Sort: critical > warning > info
	const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
	insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

	return insights;
}
