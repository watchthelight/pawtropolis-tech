import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getPersonalStats } from '$lib/server/queries/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const personal = getPersonalStats(locals.user.id, process.env.GUILD_ID);

	return { personal, windowDays: 30 };
};
