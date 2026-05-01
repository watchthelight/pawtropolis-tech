import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getQotdGrid, type QotdFilter } from '$lib/server/queries/qotd';
import type { PageServerLoad } from './$types';

const VALID_FILTERS: QotdFilter[] = ['all', 'pending', 'approved', 'rejected', 'used'];

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const filterRaw = url.searchParams.get('filter') ?? 'all';
	const filter: QotdFilter = (VALID_FILTERS as readonly string[]).includes(filterRaw)
		? (filterRaw as QotdFilter)
		: 'all';
	const search = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const cursor = url.searchParams.get('cursor');
	const cursorN = cursor ? parseInt(cursor, 10) : undefined;

	const grid = getQotdGrid(process.env.GUILD_ID, {
		filter,
		search: search || undefined,
		cursor: cursorN && Number.isFinite(cursorN) ? cursorN : undefined
	});

	return { ...grid, filter, search };
};
