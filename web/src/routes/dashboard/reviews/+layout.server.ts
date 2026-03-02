import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getReviewQueue } from '$lib/server/queries/reviews';
import type { LayoutServerLoad } from './$types';

const GUILD_ID = process.env.GUILD_ID!;

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}

	const queue = getReviewQueue(GUILD_ID);
	const pendingCount = queue.filter((item) => !item.claimedBy).length;

	return { queue, pendingCount, userId: locals.user.id };
};
