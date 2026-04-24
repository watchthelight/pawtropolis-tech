import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getHeatmapDataForRange } from '$lib/server/queries/heatmap';
import { parseTimeWindowSpec, resolveRange, formatWindowLabel } from '$lib/shared/timeWindow';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'sm')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID required');

	// Heatmap default is 7d — multi-week presets map naturally onto ranges.
	const spec = parseTimeWindowSpec(url.searchParams, '7d');
	const range = resolveRange(spec);

	const heatmap = getHeatmapDataForRange(process.env.GUILD_ID, range);
	return { heatmap, spec, windowLabel: formatWindowLabel(spec) };
};
