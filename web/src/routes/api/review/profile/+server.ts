import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';
import { getSession } from '$lib/server/session';

const DISCORD_API = 'https://discord.com/api/v10';

/** Fetch a user's profile (bio, mutual guilds) using the moderator's OAuth token. */
async function fetchDiscordProfile(accessToken: string, targetUserId: string): Promise<{ bio: string | null; status: string | null } | null> {
	try {
		const res = await fetch(`${DISCORD_API}/users/${targetUserId}/profile?with_mutual_guilds=false`, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return null;
		const data = await res.json();
		const bio = data.user?.bio || data.user_profile?.bio || null;
		// Custom status from activities (not available via this endpoint typically)
		// But the profile endpoint may include it in some fields
		const status = data.user?.status || null;
		return { bio, status };
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'gk')) error(403, 'Insufficient permissions');

	let body: { targetUserId?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	if (!body.targetUserId) error(400, 'targetUserId is required');

	// Fetch from bot API (roles, dates, banner, avatar)
	const botResult = await callBotApi('/api/review/profile', {
		userId: locals.user.id,
		tier: locals.user.tier,
		targetUserId: body.targetUserId
	});

	// Also fetch extended profile (bio) using the moderator's OAuth token
	const session = getSession(cookies);
	let bio: string | null = null;
	if (session?.accessToken) {
		const discordProfile = await fetchDiscordProfile(session.accessToken, body.targetUserId);
		if (discordProfile) {
			bio = discordProfile.bio;
		}
	}

	if (!botResult.success) {
		const status = botResult.error.includes('not found') ? 404 : botResult.error.includes('unreachable') ? 502 : 400;
		return json(botResult, { status });
	}

	// Merge bio into the response
	return json({
		success: true,
		data: {
			...(botResult as { success: true; data: Record<string, unknown> }).data,
			bio
		}
	});
};
