import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getQotdStats, getRecentSuggestions } from '$lib/server/queries/qotd';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}

	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;
	const stats = getQotdStats(guildId);
	const recent = getRecentSuggestions(guildId, 25);

	return { stats, recent };
};
