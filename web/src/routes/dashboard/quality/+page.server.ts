import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasMinTier } from '$lib/server/roles';
import {
	getQualityOverview,
	getQualityTimeseries,
	getEffortDistribution,
	getEffortLeaderboards,
	getMetricsOverlay,
	getBackfillStatus,
} from '$lib/server/queries/quality';
import { parseTimeWindowSpec, resolveRange, formatWindowLabel } from '$lib/shared/timeWindow';
import type { PageServerLoad } from './$types';

export const config = { isr: false };

// Lowlist for the metrics overlay. Loaded once at module init from the
// canonical scripts/lowlist.json shipped with the bot.
const lowlistPath = resolve(process.cwd(), '../scripts/lowlist.json');
let LOWLIST_TOKENS: Set<string> = new Set();
try {
	const raw = JSON.parse(readFileSync(lowlistPath, 'utf8'));
	LOWLIST_TOKENS = new Set((raw.tokens ?? []).map((t: string) => t.toLowerCase()));
} catch {
	// Fall back to an empty lowlist; overlay will compute "no_lowlist_hit" as 1.0
	// for every week, which is harmless.
	LOWLIST_TOKENS = new Set();
}

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (!locals.user || !hasMinTier(locals.user.tier, 'mod')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;
	const spec = parseTimeWindowSpec(url.searchParams, '30d');
	const range = resolveRange(spec);

	const overview = getQualityOverview(guildId, range);
	const timeseries = getQualityTimeseries(guildId, range);
	const distribution = getEffortDistribution(guildId, range);
	const leaderboards = getEffortLeaderboards(guildId, range, 200);
	const overlay = getMetricsOverlay(guildId, range, LOWLIST_TOKENS);
	const backfill = getBackfillStatus(guildId);

	return {
		overview,
		timeseries,
		distribution,
		leaderboards,
		overlay,
		backfill,
		spec,
		windowLabel: formatWindowLabel(spec),
	};
};
