import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getBackfillStats, getBackfillChannels, getArchiveCounts } from '$lib/server/queries/backfill';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'owner')) {
		error(403, "You don't have permission to view this page.");
	}
	return {
		initialStats: getBackfillStats(),
		initialChannels: getBackfillChannels(),
		initialCounts: getArchiveCounts()
	};
};
