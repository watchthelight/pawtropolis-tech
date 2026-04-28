/**
 * Tier gate for the entire /dashboard/tickets subtree.
 * Minimum: 'viewer' (Mod Team OR Community Ambassador OR Server Artist).
 * Reports are tier-restricted at the QUERY level inside the page loader.
 */

import { hasMinTier } from '$lib/server/roles';
import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Sign in required');
	if (!hasMinTier(user.tier, 'viewer')) {
		throw error(403, 'Staff role required to view tickets');
	}
	return {};
};
