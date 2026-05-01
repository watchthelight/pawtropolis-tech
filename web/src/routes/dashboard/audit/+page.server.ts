import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getAuditLog, getActionTypes, type AuditFilters } from '$lib/server/queries/audit';
import { cached, cacheKey, CACHE_TTL, CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const QUERY_TIMEOUT_MS = 8000;
const MAX_PAGE = 1000;

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': CACHE_HEADERS.default });
	if (!locals.user || !hasMinTier(locals.user.tier, 'admin')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');
	const guildId = process.env.GUILD_ID;

	const action = url.searchParams.get('action') || undefined;
	const search = (url.searchParams.get('q') || '').trim().slice(0, 100) || undefined;
	const requestedPage = parseInt(url.searchParams.get('page') || '1', 10) || 1;
	const page = Math.min(MAX_PAGE, Math.max(1, requestedPage));

	const nowS = Math.floor(Date.now() / 1000);
	const defaultFromS = nowS - 7 * 86400;
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	const fromS = fromParam ? Math.floor(new Date(fromParam).getTime() / 1000) || defaultFromS : defaultFromS;
	const toS = toParam ? Math.floor(new Date(toParam).getTime() / 1000) || undefined : undefined;

	const filters: AuditFilters = { action, search, fromS, toS };

	const key = cacheKey([
		'audit:log',
		guildId,
		action ?? '',
		search ?? '',
		fromS,
		toS ?? '',
		page
	]);

	try {
		const result = await Promise.race([
			cached(key, CACHE_TTL.medium, () => ({
				...getAuditLog(guildId, filters, page),
				actionTypes: getActionTypes(guildId)
			})),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('audit-query-timeout')), QUERY_TIMEOUT_MS)
			)
		]);
		return {
			...result,
			filters: {
				action: action ?? '',
				search: search ?? '',
				from: fromParam ?? '',
				to: toParam ?? ''
			}
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === 'audit-query-timeout') {
			error(504, 'Audit query took too long. Narrow the date range or remove the search term.');
		}
		throw err;
	}
};
