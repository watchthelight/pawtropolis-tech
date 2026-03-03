import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

const DISCORD_API = 'https://discord.com/api/v9';

/**
 * Fetch user profile (bio, custom status) via Discord's internal profile endpoint.
 * Uses DISCORD_USER_TOKEN env var — a user account token stored ONLY server-side.
 * This token is NEVER sent to any client, never logged, never included in responses.
 */
async function fetchDiscordProfile(targetUserId: string, guildId: string): Promise<{ bio: string | null; customStatus: string | null } | null> {
	const token = process.env.DISCORD_USER_TOKEN;
	if (!token) return null;
	try {
		const res = await fetch(
			`${DISCORD_API}/users/${targetUserId}/profile?with_mutual_guilds=false&with_mutual_friends_count=false&guild_id=${guildId}`,
			{
				headers: { Authorization: token },
				signal: AbortSignal.timeout(5000)
			}
		);
		if (!res.ok) return null;
		const data = await res.json();
		const bio = data.user_profile?.bio || null;
		let customStatus: string | null = null;
		// Check for custom status in guild member activities
		const activities: Array<{ type: number; emoji?: { name?: string }; state?: string }> =
			data.guild_member?.activities ?? [];
		const custom = activities.find((a) => a.type === 4);
		if (custom) {
			customStatus = [custom.emoji?.name, custom.state].filter(Boolean).join(' ') || null;
		}
		return { bio, customStatus };
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'gk')) error(403, 'Insufficient permissions');

	let body: { targetUserId?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	if (!body.targetUserId) error(400, 'targetUserId is required');

	const guildId = process.env.GUILD_ID || '';

	// Fetch bot API data and Discord profile in parallel
	const [botResult, discordProfile] = await Promise.all([
		callBotApi('/api/review/profile', {
			userId: locals.user.id,
			tier: locals.user.tier,
			targetUserId: body.targetUserId
		}),
		fetchDiscordProfile(body.targetUserId, guildId)
	]);

	if (!botResult.success) {
		const status = botResult.error.includes('not found') ? 404 : botResult.error.includes('unreachable') ? 502 : 400;
		return json(botResult, { status });
	}

	const data = (botResult as { success: true; data: Record<string, unknown> }).data;
	return json({
		success: true,
		data: {
			...data,
			bio: discordProfile?.bio ?? null,
			customStatus: discordProfile?.customStatus || data.customStatus || null
		}
	});
};
