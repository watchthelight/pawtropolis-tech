import { hasMinTier } from '$lib/server/roles';
import { getHomeMetrics } from '$lib/server/queries/home';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');
	const user = locals.user!;
	const includeModTier = hasMinTier(user.tier, 'mod');
	const metrics = getHomeMetrics(user.id, process.env.GUILD_ID, includeModTier);

	return { metrics };
};
