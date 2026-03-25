import { db } from '$lib/server/db';

export interface QotdStats {
	pending: number;
	approved: number;
	rejected: number;
	used: number;
}

export interface RecentSuggestion {
	id: number;
	userId: string;
	question: string;
	status: string;
	shortCode: string;
	reviewedBy: string | null;
	rejectReason: string | null;
	usedBy: string | null;
	createdAtS: number;
	reviewedAtS: number | null;
	usedAtS: number | null;
}

function count(sql: string, ...params: unknown[]): number {
	return (db().prepare(sql).get(...params) as { count: number }).count;
}

export function getQotdStats(guildId: string): QotdStats {
	const base = 'SELECT COUNT(*) as count FROM qotd_suggestion WHERE guild_id = ? AND status = ?';
	return {
		pending: count(base, guildId, 'pending'),
		approved: count(base, guildId, 'approved'),
		rejected: count(base, guildId, 'rejected'),
		used: count(base, guildId, 'used')
	};
}

export function getRecentSuggestions(guildId: string, limit: number = 25): RecentSuggestion[] {
	const rows = db()
		.prepare(
			`SELECT id, user_id, question, status, short_code,
				reviewed_by, reject_reason, used_by,
				created_at_s, reviewed_at_s, used_at_s
			 FROM qotd_suggestion
			 WHERE guild_id = ?
			 ORDER BY created_at_s DESC
			 LIMIT ?`
		)
		.all(guildId, limit) as Array<{
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
	}>;

	return rows.map((r) => ({
		id: r.id,
		userId: r.user_id,
		question: r.question,
		status: r.status,
		shortCode: r.short_code,
		reviewedBy: r.reviewed_by,
		rejectReason: r.reject_reason,
		usedBy: r.used_by,
		createdAtS: r.created_at_s,
		reviewedAtS: r.reviewed_at_s,
		usedAtS: r.used_at_s
	}));
}
