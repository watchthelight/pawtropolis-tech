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
	getApplicationFunnel
} from '$lib/server/queries/stats';
import { parseTimeWindowSpec, resolveRange, formatWindowLabel } from '$lib/shared/timeWindow';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;
	const userId = locals.user.id;

	const spec = parseTimeWindowSpec(url.searchParams, 'all');
	const range = resolveRange(spec);

	const personal = getPersonalStats(userId, guildId, range);
	const trend = getPersonalStatsTrend(userId, guildId, range);
	const timeline = getActivityTimeline(userId, guildId, range);
	const responseTrend = getResponseTrend(userId, guildId, range);
	const team = getTeamStats(guildId, range);
	const modBreakdowns = getModBreakdowns(guildId, range);
	const decisionPercentiles = getDecisionPercentiles(guildId, range);
	const inviteSources = getInviteSourceBreakdown(guildId, range);
	const funnel = getApplicationFunnel(guildId, range);

	return {
		personal,
		trend,
		timeline,
		responseTrend,
		team,
		modBreakdowns,
		decisionPercentiles,
		inviteSources,
		funnel,
		spec,
		windowLabel: formatWindowLabel(spec),
		windowDays: range.days,
		userId
	};
};
