import { error, type RequestHandler } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { db } from '$lib/server/db';
import { parseTimeWindowSpec, resolveRange, formatWindowLabel } from '$lib/shared/timeWindow';

/**
 * GET /api/export?type=stats|audit|config_audit
 *   [&window=7d|30d|90d|all|custom][&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * Streams CSV export for dashboard data. Requires gk tier minimum.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, 'Not authorized');
	}

	const type = url.searchParams.get('type');
	const guildId = process.env.GUILD_ID;
	if (!guildId) error(500, 'GUILD_ID not set');

	const spec = parseTimeWindowSpec(url.searchParams, 'all');
	const range = resolveRange(spec);
	const label = formatWindowLabel(spec).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

	let rows: Record<string, unknown>[];
	let filename: string;

	switch (type) {
		case 'stats': {
			rows = db()
				.prepare(
					`SELECT
						actor_id as mod_id,
						action,
						app_id,
						created_at_s,
						datetime(created_at_s, 'unixepoch') as created_at_iso
					FROM action_log
					WHERE guild_id = ? AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'claim')
						AND (? = 0 OR created_at_s >= ?)
						AND created_at_s < ?
					ORDER BY created_at_s DESC
					LIMIT 10000`
				)
				.all(guildId, range.startS, range.startS, range.endS) as Record<string, unknown>[];
			filename = `review-actions-${label}.csv`;
			break;
		}
		case 'audit': {
			if (!hasMinTier(locals.user.tier, 'admin')) error(403, 'Admin required for audit export');
			rows = db()
				.prepare(
					`SELECT * FROM audit_results
					WHERE guild_id = ?
						AND (? = 0 OR strftime('%s', created_at) >= ?)
						AND strftime('%s', created_at) < ?
					ORDER BY created_at DESC
					LIMIT 10000`
				)
				.all(
					guildId,
					range.startS,
					String(range.startS),
					String(range.endS)
				) as Record<string, unknown>[];
			filename = `audit-results-${label}.csv`;
			break;
		}
		case 'config_audit': {
			if (!hasMinTier(locals.user.tier, 'admin')) error(403, 'Admin required for config export');
			rows = db()
				.prepare(
					`SELECT * FROM config_audit_log
					WHERE guild_id = ?
						AND (? = 0 OR changed_at_s >= ?)
						AND changed_at_s < ?
					ORDER BY changed_at_s DESC
					LIMIT 5000`
				)
				.all(guildId, range.startS, range.startS, range.endS) as Record<string, unknown>[];
			filename = `config-audit-${label}.csv`;
			break;
		}
		default:
			error(400, 'Invalid export type. Use: stats, audit, config_audit');
	}

	if (rows.length === 0) {
		error(404, 'No data to export');
	}

	const headers = Object.keys(rows[0]);
	const csvLines = [
		headers.join(','),
		...rows.map((row) =>
			headers
				.map((h) => {
					const val = row[h];
					if (val === null || val === undefined) return '';
					const str = String(val);
					return str.includes(',') || str.includes('"') || str.includes('\n')
						? `"${str.replace(/"/g, '""')}"`
						: str;
				})
				.join(',')
		)
	];

	return new Response(csvLines.join('\n'), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache'
		}
	});
};
