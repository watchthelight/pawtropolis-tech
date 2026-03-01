import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, 'Access denied');
	}
	return {};
};
