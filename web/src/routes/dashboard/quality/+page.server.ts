import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import {
	getQualityOverview,
	getQualityTimeseries,
	getEffortDistribution,
	getEffortLeaderboards,
	getSubstantivenessSparkline,
	getSubstantivenessTrend,
	getMetricsOverlay,
	getBackfillStatus
} from '$lib/server/queries/quality';
import { getQualityLowlistTokens } from '$lib/server/quality-lowlist';
import {
	parseTimeWindowSpec,
	resolveRange,
	formatWindowLabel,
	rangeCacheKeyParts
} from '$lib/shared/timeWindow';
import { cached, cacheKey, CACHE_TTL, CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const config = { isr: false };

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': CACHE_HEADERS.default });
	if (!locals.user || !hasMinTier(locals.user.tier, 'mod')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;
	const spec = parseTimeWindowSpec(url.searchParams, '30d');
	const range = resolveRange(spec);
	// Auto-pick bucket size based on preset: 7d→5min, 30d→30min, 90d→1h, all→1d.
	// Custom windows are stable. Reroll less = more cache hits = sub-100ms switches.
	const rangeKey = rangeCacheKeyParts(range);

	const fastKey = cacheKey(['quality:fast', guildId, ...rangeKey]);
	const fastData = await cached(fastKey, CACHE_TTL.veryLong, () => ({
		overview: getQualityOverview(guildId, range),
		timeseries: getQualityTimeseries(guildId, range),
		distribution: getEffortDistribution(guildId, range),
		substSparkline: getSubstantivenessSparkline(guildId, range),
		substTrend: getSubstantivenessTrend(guildId, range)
	}));

	// Stream the heavy/slower payloads as Promises so the page paints the fast
	// data immediately and the rest fills in. SvelteKit serializes streamed
	// promises lazily — leaving the page mid-stream does not block navigation.
	const leaderboardsPromise = cached(
		cacheKey(['quality:leaderboards', guildId, ...rangeKey]),
		CACHE_TTL.veryLong,
		() => getEffortLeaderboards(guildId, range, 200)
	);

	const overlayPromise = cached(
		cacheKey(['quality:overlay', guildId, ...rangeKey]),
		CACHE_TTL.veryLong,
		() => getMetricsOverlay(guildId, range, getQualityLowlistTokens())
	);

	const backfillPromise = cached(
		cacheKey(['quality:backfill', guildId]),
		CACHE_TTL.long,
		() => getBackfillStatus(guildId)
	);

	return {
		...fastData,
		streamed: {
			leaderboards: leaderboardsPromise,
			overlay: overlayPromise,
			backfill: backfillPromise
		},
		spec,
		windowLabel: formatWindowLabel(spec)
	};
};
