import { error, json } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getMetricsOverlay } from '$lib/server/queries/quality';
import { getQualityLowlistTokens } from '$lib/server/quality-lowlist';
import { cached, cacheKey, CACHE_HEADERS, CACHE_TTL } from '$lib/server/cache';
import { parseTimeWindowSpec, resolveRange } from '$lib/shared/timeWindow';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': CACHE_HEADERS.default });
	if (!locals.user || !hasMinTier(locals.user.tier, 'mod')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;
	const spec = parseTimeWindowSpec(url.searchParams, '30d');
	const range = resolveRange(spec);
	const overlayKey = cacheKey([
		'quality:overlay',
		guildId,
		Math.floor(range.startS / 300),
		Math.floor(range.endS / 300)
	]);

	const overlay = await cached(overlayKey, CACHE_TTL.long, () =>
		getMetricsOverlay(guildId, range, getQualityLowlistTokens())
	);

	return json({ overlay });
};
