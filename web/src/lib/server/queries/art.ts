import { db } from '$lib/server/db';
import { normalizeTimestamp } from './shared';

export interface ArtJobHistoryItem {
	id: number;
	jobNumber: number;
	artistName: string;
	artistId: string;
	recipientName: string;
	recipientId: string;
	ticketType: string;
	status: string;
	assignedAt: number;
	completedAt: number | null;
}

export interface LeaderboardItem {
	artistId: string;
	artistName: string;
	completedCount: number;
}

export interface UserSearchResult {
	userId: string;
	displayName: string;
	avatarUrl: string | null;
}

export interface ArtistItem {
	userId: string;
	displayName: string;
	position: number;
	assignmentsCount: number;
	lastAssignedAt: number | null;
	skipped: boolean;
	skipReason: string | null;
}

export interface ArtJobItem {
	id: number;
	jobNumber: number;
	artistJobNumber: number;
	artistName: string;
	artistId: string;
	recipientName: string;
	recipientId: string;
	ticketType: string;
	status: string;
	assignedAt: number;
	updatedAt: number;
}

/**
 * Get the artist rotation queue, ordered by position.
 * JOIN user_cache for display names.
 */
export function getArtistQueue(guildId: string): ArtistItem[] {
	const rows = db()
		.prepare(
			`SELECT
				aq.user_id,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(aq.user_id, -6)) as display_name,
				aq.position,
				aq.assignments_count,
				aq.last_assigned_at,
				aq.skipped,
				aq.skip_reason
			FROM artist_queue aq
			LEFT JOIN user_cache u ON aq.user_id = u.user_id AND u.guild_id = ?
			WHERE aq.guild_id = ?
			ORDER BY aq.position ASC`
		)
		.all(guildId, guildId) as {
		user_id: string;
		display_name: string;
		position: number;
		assignments_count: number;
		last_assigned_at: string | null;
		skipped: number;
		skip_reason: string | null;
	}[];

	return rows.map((r) => ({
		userId: r.user_id,
		displayName: r.display_name,
		position: r.position,
		assignmentsCount: r.assignments_count,
		lastAssignedAt: normalizeTimestamp(r.last_assigned_at),
		skipped: r.skipped === 1,
		skipReason: r.skip_reason
	}));
}

/**
 * Get active art jobs (not done/cancelled), most recent first.
 * JOIN user_cache for artist and recipient display names.
 */
export function getActiveJobs(guildId: string): ArtJobItem[] {
	const rows = db()
		.prepare(
			`SELECT
				j.id,
				j.job_number,
				j.artist_job_number,
				COALESCE(ua.display_name, ua.global_name, ua.username, 'User ' || substr(j.artist_id, -6)) as artist_name,
				j.artist_id,
				COALESCE(ur.display_name, ur.global_name, ur.username, 'User ' || substr(j.recipient_id, -6)) as recipient_name,
				j.recipient_id,
				j.ticket_type,
				j.status,
				j.assigned_at,
				j.updated_at
			FROM art_job j
			LEFT JOIN user_cache ua ON j.artist_id = ua.user_id AND ua.guild_id = ?
			LEFT JOIN user_cache ur ON j.recipient_id = ur.user_id AND ur.guild_id = ?
			WHERE j.guild_id = ?
				AND j.status NOT IN ('done', 'cancelled')
			ORDER BY j.assigned_at DESC`
		)
		.all(guildId, guildId, guildId) as {
		id: number;
		job_number: number;
		artist_job_number: number;
		artist_name: string;
		artist_id: string;
		recipient_name: string;
		recipient_id: string;
		ticket_type: string;
		status: string;
		assigned_at: string;
		updated_at: string;
	}[];

	return rows.map((r) => ({
		id: r.id,
		jobNumber: r.job_number,
		artistJobNumber: r.artist_job_number,
		artistName: r.artist_name,
		artistId: r.artist_id,
		recipientName: r.recipient_name,
		recipientId: r.recipient_id,
		ticketType: r.ticket_type,
		status: r.status,
		assignedAt: normalizeTimestamp(r.assigned_at) ?? 0,
		updatedAt: normalizeTimestamp(r.updated_at) ?? 0
	}));
}

/**
 * Get paginated job history (done + cancelled), most recent first.
 */
export function getJobHistory(guildId: string, page = 1, limit = 20): ArtJobHistoryItem[] {
	const offset = (page - 1) * limit;
	const rows = db()
		.prepare(
			`SELECT
				j.id,
				j.job_number,
				COALESCE(ua.display_name, ua.global_name, ua.username, 'User ' || substr(j.artist_id, -6)) as artist_name,
				j.artist_id,
				COALESCE(ur.display_name, ur.global_name, ur.username, 'User ' || substr(j.recipient_id, -6)) as recipient_name,
				j.recipient_id,
				j.ticket_type,
				j.status,
				j.assigned_at,
				j.completed_at
			FROM art_job j
			LEFT JOIN user_cache ua ON j.artist_id = ua.user_id AND ua.guild_id = ?
			LEFT JOIN user_cache ur ON j.recipient_id = ur.user_id AND ur.guild_id = ?
			WHERE j.guild_id = ?
				AND j.status IN ('done', 'cancelled')
			ORDER BY j.updated_at DESC
			LIMIT ? OFFSET ?`
		)
		.all(guildId, guildId, guildId, limit, offset) as {
		id: number;
		job_number: number;
		artist_name: string;
		artist_id: string;
		recipient_name: string;
		recipient_id: string;
		ticket_type: string;
		status: string;
		assigned_at: string;
		completed_at: string | null;
	}[];

	return rows.map((r) => ({
		id: r.id,
		jobNumber: r.job_number,
		artistName: r.artist_name,
		artistId: r.artist_id,
		recipientName: r.recipient_name,
		recipientId: r.recipient_id,
		ticketType: r.ticket_type,
		status: r.status,
		assignedAt: normalizeTimestamp(r.assigned_at) ?? 0,
		completedAt: normalizeTimestamp(r.completed_at)
	}));
}

/**
 * Get leaderboard (monthly or all-time) with display names from user_cache.
 */
export function getLeaderboard(guildId: string, type: 'monthly' | 'alltime', limit = 10): LeaderboardItem[] {
	const whereClause =
		type === 'monthly'
			? `AND completed_at >= date('now', 'start of month')`
			: '';

	const rows = db()
		.prepare(
			`SELECT
				j.artist_id,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(j.artist_id, -6)) as artist_name,
				COUNT(*) as completed_count
			FROM art_job j
			LEFT JOIN user_cache u ON j.artist_id = u.user_id AND u.guild_id = ?
			WHERE j.guild_id = ? AND j.status = 'done' ${whereClause}
			GROUP BY j.artist_id
			ORDER BY completed_count DESC
			LIMIT ?`
		)
		.all(guildId, guildId, limit) as {
		artist_id: string;
		artist_name: string;
		completed_count: number;
	}[];

	return rows.map((r) => ({
		artistId: r.artist_id,
		artistName: r.artist_name,
		completedCount: r.completed_count
	}));
}

/**
 * Search user_cache by username/display_name (fuzzy). Used for recipient picker + add artist.
 */
export function searchUsers(
	guildId: string,
	query: string,
	excludeArtists = false,
	limit = 10
): UserSearchResult[] {
	const likeQuery = `%${query}%`;
	const excludeClause = excludeArtists
		? `AND u.user_id NOT IN (SELECT user_id FROM artist_queue WHERE guild_id = ?)`
		: '';
	const params: unknown[] = excludeArtists
		? [guildId, likeQuery, likeQuery, likeQuery, likeQuery, guildId, limit]
		: [guildId, likeQuery, likeQuery, likeQuery, likeQuery, limit];

	const rows = db()
		.prepare(
			`SELECT
				u.user_id,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(u.user_id, -6)) as display_name,
				u.avatar_url
			FROM user_cache u
			WHERE u.guild_id = ?
				AND (
					u.username LIKE ?
					OR u.display_name LIKE ?
					OR u.global_name LIKE ?
					OR u.user_id LIKE ?
				)
				${excludeClause}
			ORDER BY u.display_name ASC
			LIMIT ?`
		)
		.all(...params) as {
		user_id: string;
		display_name: string;
		avatar_url: string | null;
	}[];

	return rows.map((r) => ({
		userId: r.user_id,
		displayName: r.display_name,
		avatarUrl: r.avatar_url
	}));
}
