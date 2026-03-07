import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getFlaggedUsers } from '$lib/server/queries/flags';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'sm')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const flags = getFlaggedUsers(process.env.GUILD_ID);
	return { flags };
};
