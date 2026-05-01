import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import {
	getQualityOverview,
	getQualityTimeseries,
	getEffortDistribution,
	getEffortLeaderboards,
	getSubstantivenessSparkline,
	getSubstantivenessTrend,
} from '$lib/server/queries/quality';
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
	const rangeKey = rangeCacheKeyParts(range, 300);
	const dataKey = cacheKey(['quality:data', guildId, ...rangeKey]);

	const fastKey = cacheKey(['quality:fast', guildId, ...rangeKey]);
	const fastData = await cached(fastKey, CACHE_TTL.long, () => ({
		overview: getQualityOverview(guildId, range),
		timeseries: getQualityTimeseries(guildId, range),
		distribution: getEffortDistribution(guildId, range),
		substSparkline: getSubstantivenessSparkline(guildId, range),
		substTrend: getSubstantivenessTrend(guildId, range)
	}));

	// Leaderboards are the heaviest query (GROUP BY all authors). Stream as a
	// promise so the page renders the rest immediately and the table skeletons
	// in until it resolves.
	const leaderboardsPromise = cached(
		cacheKey(['quality:leaderboards', guildId, ...rangeKey]),
		CACHE_TTL.long,
		() => getEffortLeaderboards(guildId, range, 200)
	);

	return {
		...fastData,
		streamed: { leaderboards: leaderboardsPromise },
		spec,
		windowLabel: formatWindowLabel(spec)
	};
};
