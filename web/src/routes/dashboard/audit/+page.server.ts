import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getAuditLog, getActionTypes, type AuditFilters } from '$lib/server/queries/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'admin')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');
	const guildId = process.env.GUILD_ID;

	// Parse filters from URL search params
	const action = url.searchParams.get('action') || undefined;
	const search = url.searchParams.get('q') || undefined;
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

	// Date range: default last 7 days
	const nowS = Math.floor(Date.now() / 1000);
	const defaultFromS = nowS - 7 * 86400;
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	const fromS = fromParam ? Math.floor(new Date(fromParam).getTime() / 1000) || defaultFromS : defaultFromS;
	const toS = toParam ? Math.floor(new Date(toParam).getTime() / 1000) || undefined : undefined;

	const filters: AuditFilters = { action, search, fromS, toS };
	const result = getAuditLog(guildId, filters, page);
	const actionTypes = getActionTypes(guildId);

	return { ...result, actionTypes, filters: { action: action ?? '', search: search ?? '', from: fromParam ?? '', to: toParam ?? '' } };
};
