import { hasMinTier } from '$lib/server/roles';
import { getHomeMetrics } from '$lib/server/queries/home';
import type { PageServerLoad } from './$types';

const GUILD_ID = process.env.GUILD_ID!;

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const includeModTier = hasMinTier(user.tier, 'mod');
	const metrics = getHomeMetrics(user.id, GUILD_ID, includeModTier);

	return { metrics };
};
