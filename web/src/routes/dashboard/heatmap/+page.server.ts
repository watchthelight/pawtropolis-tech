import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getHeatmapData } from '$lib/server/queries/heatmap';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'sm')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID required');

	const heatmap = getHeatmapData(process.env.GUILD_ID);
	return { heatmap };
};
