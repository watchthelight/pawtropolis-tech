import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getReviewQueue, getReviewHistory } from '$lib/server/queries/reviews';
import type { LayoutServerLoad } from './$types';

const GUILD_ID = process.env.GUILD_ID!;

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}

	const queue = getReviewQueue(GUILD_ID);
	const history = getReviewHistory(GUILD_ID, 50);

	const userId = locals.user.id;
	const unclaimed = queue.filter((item) => !item.claimedBy).length;
	const myClaims = queue.filter((item) => item.claimedBy === userId).length;

	return {
		queue,
		history,
		userId,
		tabCounts: {
			unclaimed,
			mine: myClaims,
			all: queue.length,
			history: history.length
		}
	};
};
