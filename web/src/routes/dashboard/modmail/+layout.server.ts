import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getModmailThreads, getModmailStats } from '$lib/server/queries/modmail';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const filter = (url.searchParams.get('filter') ?? 'all') as 'open' | 'closed' | 'all';
	const threads = getModmailThreads(process.env.GUILD_ID, filter);
	const stats = getModmailStats(process.env.GUILD_ID);

	return { threads, stats, filter };
};
