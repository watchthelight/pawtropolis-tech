import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getHeatmapData } from '$lib/server/queries/heatmap';
import type { PageServerLoad } from './$types';

const VALID_WEEKS = [1, 2, 4, 8] as const;
type WeekCount = (typeof VALID_WEEKS)[number];

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'sm')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID required');

	const rawWeeks = Number(url.searchParams.get('weeks')) || 1;
	const weeks: WeekCount = VALID_WEEKS.includes(rawWeeks as WeekCount)
		? (rawWeeks as WeekCount)
		: 1;

	const heatmap = getHeatmapData(process.env.GUILD_ID, weeks);
	return { heatmap, weeks };
};
