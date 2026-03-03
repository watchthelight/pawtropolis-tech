import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

const PROFILE_PROXY_URL = process.env.DISCORD_PROFILE_PROXY_URL || '';
const PROFILE_PROXY_SECRET = process.env.DISCORD_PROFILE_PROXY_SECRET || '';

/** Fetch bio + custom status via Cloudflare Worker proxy (bypasses datacenter IP block). */
async function fetchDiscordProfile(targetUserId: string, guildId: string): Promise<{ bio: string | null; customStatus: string | null } | null> {
	if (!PROFILE_PROXY_URL || !PROFILE_PROXY_SECRET) return null;
	try {
		const res = await fetch(PROFILE_PROXY_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Proxy-Secret': PROFILE_PROXY_SECRET
			},
			body: JSON.stringify({ targetUserId, guildId }),
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		return await res.json();
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

	// Fetch bot API data and Discord profile (bio) in parallel
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
