import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { userTier } = await parent();
	if (!hasMinTier(userTier, 'sa')) {
		error(403, "You don't have permission to view this page.");
	}
	return {};
};
