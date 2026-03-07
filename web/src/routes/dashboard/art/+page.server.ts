import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getArtistQueue, getActiveJobs } from '$lib/server/queries/art';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'sm')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const queue = getArtistQueue(process.env.GUILD_ID);
	const jobs = getActiveJobs(process.env.GUILD_ID);
	return { queue, jobs };
};
