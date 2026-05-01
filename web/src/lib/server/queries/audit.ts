import { db } from '$lib/server/db';
import { normalizeTimestamp } from './shared';

export interface AuditEntry {
	id: number;
	actorId: string;
	actorName: string;
	subjectId: string | null;
	subjectName: string | null;
	appCode: string | null;
	action: string;
	reason: string | null;
	metaJson: string | null;
	createdAt: number;
}

export interface AuditFilters {
	action?: string;
	search?: string;
	fromS?: number;
	toS?: number;
}

export interface AuditResult {
	entries: AuditEntry[];
	total: number;
	page: number;
	pageSize: number;
}

const PAGE_SIZE = 50;

/**
 * Sanitize user input for FTS5 MATCH. FTS5 treats some characters as syntax
 * (-, ", *, etc.); we strip them, then append `*` for prefix matching so
 * "alic" matches "alice".
 */
function sanitizeFtsTerm(raw: string): string {
	const cleaned = raw
		.replace(/["()\\:^-]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 2)
		.map((t) => `${t}*`)
		.join(' AND ');
	return cleaned;
}

/**
 * Get user_ids whose name fields match the search pattern. Bounded LIMIT so a
 * vague search doesn't balloon the IN list.
 */
function lookupUserIdsByName(guildId: string, pattern: string): string[] {
	const rows = db()
		.prepare(
			`SELECT user_id FROM user_cache
			 WHERE guild_id = ?
			   AND (display_name LIKE ? OR username LIKE ? OR global_name LIKE ?)
			 LIMIT 200`
		)
		.all(guildId, pattern, pattern, pattern) as { user_id: string }[];
	return rows.map((r) => r.user_id);
}

/**
 * Get distinct action types for filter dropdown.
 */
export function getActionTypes(guildId: string): string[] {
	const rows = db()
		.prepare('SELECT DISTINCT action FROM action_log WHERE guild_id = ? ORDER BY action')
		.all(guildId) as { action: string }[];
	return rows.map((r) => r.action);
}

/**
 * Query audit log with filters and pagination.
 * Default: last 7 days, newest first, 50 per page.
 */
export function getAuditLog(
	guildId: string,
	filters: AuditFilters = {},
	page = 1
): AuditResult {
	const conditions: string[] = ['a.guild_id = ?'];
	const params: unknown[] = [guildId];

	// Date range
	if (filters.fromS) {
		conditions.push('a.created_at_s >= ?');
		params.push(filters.fromS);
	}
	if (filters.toS) {
		conditions.push('a.created_at_s <= ?');
		params.push(filters.toS);
	}

	// Action type filter
	if (filters.action) {
		conditions.push('a.action = ?');
		params.push(filters.action);
	}

	// Search: prefer FTS5 over reason / app_code / actor_id / subject_id; fall
	// back to a small user_cache name LIKE that returns matching user_ids and
	// OR's them into the action_log filter. Total cost stays bounded by the
	// FTS index + user_cache size, NOT the full action_log table scan.
	if (filters.search) {
		const ftsTerm = sanitizeFtsTerm(filters.search);
		const searchPattern = `%${filters.search}%`;
		const nameMatchIds = lookupUserIdsByName(guildId, searchPattern);

		const orParts: string[] = [];
		if (ftsTerm) {
			orParts.push(`a.id IN (SELECT rowid FROM action_log_fts WHERE action_log_fts MATCH ?)`);
			params.push(ftsTerm);
		}
		if (nameMatchIds.length > 0) {
			const placeholders = nameMatchIds.map(() => '?').join(',');
			orParts.push(`a.actor_id IN (${placeholders})`);
			params.push(...nameMatchIds);
			orParts.push(`a.subject_id IN (${placeholders})`);
			params.push(...nameMatchIds);
		}
		if (orParts.length > 0) {
			conditions.push(`(${orParts.join(' OR ')})`);
		} else {
			// Search produced no possible matches — short-circuit with impossible filter.
			conditions.push(`1 = 0`);
		}
	}

	const whereClause = conditions.join(' AND ');

	// Total count. The user_cache joins are only needed when a name search is
	// active (the search regex hits ua.display_name etc.). For the common no-search
	// case skip them — count over a multi-million-row action_log table without
	// joins is the difference between sub-100ms and multi-second.
	const needsUserCacheJoin = !!filters.search;
	const countSql = needsUserCacheJoin
		? `SELECT COUNT(*) as count
		   FROM action_log a
		   LEFT JOIN user_cache ua ON a.actor_id = ua.user_id AND ua.guild_id = a.guild_id
		   LEFT JOIN user_cache us ON a.subject_id = us.user_id AND us.guild_id = a.guild_id
		   WHERE ${whereClause}`
		: `SELECT COUNT(*) as count FROM action_log a WHERE ${whereClause}`;
	const countRow = db().prepare(countSql).get(...params) as { count: number };
	const total = countRow.count;

	// Paginated results
	const offset = (page - 1) * PAGE_SIZE;
	const rows = db()
		.prepare(
			`SELECT
				a.id,
				a.actor_id,
				COALESCE(ua.display_name, ua.global_name, ua.username, 'User ' || substr(a.actor_id, -6)) as actor_name,
				a.subject_id,
				CASE WHEN a.subject_id IS NOT NULL
					THEN COALESCE(us.display_name, us.global_name, us.username, 'User ' || substr(a.subject_id, -6))
					ELSE NULL
				END as subject_name,
				a.app_code,
				a.action,
				a.reason,
				a.meta_json,
				a.created_at_s
			FROM action_log a
			LEFT JOIN user_cache ua ON a.actor_id = ua.user_id AND ua.guild_id = a.guild_id
			LEFT JOIN user_cache us ON a.subject_id = us.user_id AND us.guild_id = a.guild_id
			WHERE ${whereClause}
			ORDER BY a.created_at_s DESC
			LIMIT ? OFFSET ?`
		)
		.all(...params, PAGE_SIZE, offset) as {
		id: number;
		actor_id: string;
		actor_name: string;
		subject_id: string | null;
		subject_name: string | null;
		app_code: string | null;
		action: string;
		reason: string | null;
		meta_json: string | null;
		created_at_s: number;
	}[];

	return {
		entries: rows.map((r) => ({
			id: r.id,
			actorId: r.actor_id,
			actorName: r.actor_name,
			subjectId: r.subject_id,
			subjectName: r.subject_name,
			appCode: r.app_code,
			action: r.action,
			reason: r.reason,
			metaJson: r.meta_json,
			createdAt: normalizeTimestamp(r.created_at_s) ?? 0
		})),
		total,
		page,
		pageSize: PAGE_SIZE
	};
}
