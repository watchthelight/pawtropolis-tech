import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import {
	getPersonalStats,
	getPersonalStatsTrend,
	getActivityTimeline,
	getResponseTrend,
	getTeamStats,
	getModBreakdowns,
	getDecisionPercentiles,
	getInviteSourceBreakdown,
	getApplicationFunnel,
	windowStartForWindow,
	windowDaysForWindow,
	type TimeWindow
} from '$lib/server/queries/stats';
import type { PageServerLoad } from './$types';

const VALID_WINDOWS: TimeWindow[] = ['7d', '30d', '90d', 'all'];

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const rawWindow = url.searchParams.get('window') ?? 'all';
	const window: TimeWindow = VALID_WINDOWS.includes(rawWindow as TimeWindow)
		? (rawWindow as TimeWindow)
		: 'all';

	const guildId = process.env.GUILD_ID;
	const userId = locals.user.id;
	const windowStartS = windowStartForWindow(window);
	const days = windowDaysForWindow(window);

	const personal = getPersonalStats(userId, guildId, days);
	const trend = getPersonalStatsTrend(userId, guildId, window);
	const timeline = getActivityTimeline(userId, guildId, windowStartS);
	const responseTrend = getResponseTrend(userId, guildId, windowStartS);
	const team = getTeamStats(guildId, windowStartS);
	const modBreakdowns = getModBreakdowns(guildId, windowStartS);
	const decisionPercentiles = getDecisionPercentiles(guildId, windowStartS);
	const inviteSources = getInviteSourceBreakdown(guildId, windowStartS);
	const funnel = getApplicationFunnel(guildId, windowStartS);

	return { personal, trend, timeline, responseTrend, team, modBreakdowns, decisionPercentiles, inviteSources, funnel, window, windowDays: days, userId };
};
