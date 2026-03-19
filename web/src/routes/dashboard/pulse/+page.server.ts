import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getPulseMetrics, getNewsletterStats, getInsights, getGuildSnapshot, getTopVoiceChannels, getLevelRoleStats } from '$lib/server/queries/pulse';
import type { PageServerLoad } from './$types';

export const config = { isr: false };

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (!locals.user || !hasMinTier(locals.user.tier, 'mod')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;
	const metrics = getPulseMetrics(guildId);
	const newsletterStats = getNewsletterStats(guildId);
	const insights = getInsights(guildId);
	const guildSnapshot = getGuildSnapshot(guildId);
	const topVoiceChannels = getTopVoiceChannels(guildId);
	const levelRoleStats = await getLevelRoleStats(locals.user.id, locals.user.tier).catch(() => null);
	return { metrics, newsletterStats, insights, guildSnapshot, topVoiceChannels, levelRoleStats };
};
