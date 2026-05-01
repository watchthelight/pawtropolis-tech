import { db } from '$lib/server/db';

export interface QotdStats {
	pending: number;
	approved: number;
	rejected: number;
	used: number;
}

export interface QotdSuggestion {
	id: number;
	userId: string;
	suggesterName: string;
	suggesterAvatar: string | null;
	question: string;
	status: 'pending' | 'approved' | 'rejected' | 'used';
	shortCode: string;
	reviewedBy: string | null;
	reviewedByName: string | null;
	rejectReason: string | null;
	usedBy: string | null;
	usedByName: string | null;
	createdAtS: number;
	reviewedAtS: number | null;
	usedAtS: number | null;
}

export type QotdFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'used';

export interface QotdGridResult {
	items: QotdSuggestion[];
	nextCursor: number | null;
	stats: QotdStats;
}

const PAGE_SIZE = 60;

/**
 * Single-pass stats over qotd_suggestion via SUM(CASE) — replaces 4 separate
 * COUNT queries.
 */
export function getQotdStats(guildId: string): QotdStats {
	const row = db().prepare(`
		SELECT
			SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) AS pending,
			SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
			SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
			SUM(CASE WHEN status='used'     THEN 1 ELSE 0 END) AS used
		FROM qotd_suggestion WHERE guild_id = ?
	`).get(guildId) as { pending: number | null; approved: number | null; rejected: number | null; used: number | null };
	return {
		pending: row.pending ?? 0,
		approved: row.approved ?? 0,
		rejected: row.rejected ?? 0,
		used: row.used ?? 0
	};
}

/**
 * Grid-paginated suggestions for the dashboard. Keyset pagination on (created_at_s, id)
 * — `cursor` is the last item's id from the previous page. First page: cursor undefined.
 *
 * Filter narrows by status; search runs LIKE over the question text (cheap on a
 * small qotd_suggestion table).
 */
export function getQotdGrid(
	guildId: string,
	opts: { filter?: QotdFilter; search?: string; cursor?: number } = {}
): QotdGridResult {
	const { filter = 'all', search, cursor } = opts;
	const conditions: string[] = ['s.guild_id = ?'];
	const params: unknown[] = [guildId];

	if (filter !== 'all') {
		conditions.push('s.status = ?');
		params.push(filter);
	}
	if (search && search.trim()) {
		conditions.push('s.question LIKE ?');
		params.push(`%${search.trim()}%`);
	}
	if (cursor != null) {
		// Keyset: anything strictly older than the cursor row in the same id order.
		conditions.push('s.id < ?');
		params.push(cursor);
	}

	const whereClause = conditions.join(' AND ');
	const rows = db().prepare(`
		SELECT
			s.id, s.user_id, s.question, s.status, s.short_code,
			s.reviewed_by, s.reject_reason, s.used_by,
			s.created_at_s, s.reviewed_at_s, s.used_at_s,
			COALESCE(us.display_name, us.global_name, us.username) AS suggester_name,
			us.avatar_url AS suggester_avatar,
			COALESCE(ur.display_name, ur.global_name, ur.username) AS reviewer_name,
			COALESCE(uu.display_name, uu.global_name, uu.username) AS user_name
		FROM qotd_suggestion s
		LEFT JOIN user_cache us ON us.guild_id = s.guild_id AND us.user_id = s.user_id
		LEFT JOIN user_cache ur ON ur.guild_id = s.guild_id AND ur.user_id = s.reviewed_by
		LEFT JOIN user_cache uu ON uu.guild_id = s.guild_id AND uu.user_id = s.used_by
		WHERE ${whereClause}
		ORDER BY s.id DESC
		LIMIT ?
	`).all(...params, PAGE_SIZE + 1) as Array<{
		id: number;
		user_id: string;
		question: string;
		status: string;
		short_code: string;
		reviewed_by: string | null;
		reject_reason: string | null;
		used_by: string | null;
		created_at_s: number;
		reviewed_at_s: number | null;
		used_at_s: number | null;
		suggester_name: string | null;
		suggester_avatar: string | null;
		reviewer_name: string | null;
		user_name: string | null;
	}>;

	let nextCursor: number | null = null;
	if (rows.length > PAGE_SIZE) {
		const trailing = rows.pop();
		nextCursor = trailing ? trailing.id : null;
	}

	const items: QotdSuggestion[] = rows.map((r) => ({
		id: r.id,
		userId: r.user_id,
		suggesterName: r.suggester_name ?? `User ${r.user_id.slice(-6)}`,
		suggesterAvatar: r.suggester_avatar,
		question: r.question,
		status: r.status as QotdSuggestion['status'],
		shortCode: r.short_code,
		reviewedBy: r.reviewed_by,
		reviewedByName: r.reviewer_name,
		rejectReason: r.reject_reason,
		usedBy: r.used_by,
		usedByName: r.user_name,
		createdAtS: r.created_at_s,
		reviewedAtS: r.reviewed_at_s,
		usedAtS: r.used_at_s
	}));

	return { items, nextCursor, stats: getQotdStats(guildId) };
}

// Backwards-compat: a small list for old callers.
export function getRecentSuggestions(guildId: string, limit = 25) {
	const grid = getQotdGrid(guildId);
	return grid.items.slice(0, limit);
}
