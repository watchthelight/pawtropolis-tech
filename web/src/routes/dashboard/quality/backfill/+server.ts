import { error, json } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getBackfillStatus } from '$lib/server/queries/quality';
import { cached, cacheKey, CACHE_HEADERS, CACHE_TTL } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, setHeaders }) => {
	setHeaders({ 'cache-control': CACHE_HEADERS.default });
	if (!locals.user || !hasMinTier(locals.user.tier, 'mod')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const backfill = await cached(
		cacheKey(['quality:backfill', process.env.GUILD_ID]),
		CACHE_TTL.long,
		() => getBackfillStatus(process.env.GUILD_ID!)
	);

	return json({ backfill });
};
