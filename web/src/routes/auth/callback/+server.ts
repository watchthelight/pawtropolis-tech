import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCode, fetchUser, fetchGuildMember, avatarUrl, bannerUrl } from '$lib/server/discord';
import { detectTier } from '$lib/server/roles';
import { setSession } from '$lib/server/session';
import { getGuildId, getOAuth2RedirectUri } from '$lib/server/env';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get('oauth_state');

	// Clear state cookie
	cookies.delete('oauth_state', { path: '/' });

	// Validate state
	if (!code || !state || state !== storedState) {
		error(400, 'Invalid OAuth2 state. Please try logging in again.');
	}

	try {
		// Exchange code for tokens
		const tokens = await exchangeCode(code, getOAuth2RedirectUri());

		// Fetch user profile (includes accent_color, banner)
		const user = await fetchUser(tokens.access_token);
		// Note: accent_color=0 means Discord returned black (Nitro theme colors not in API)
		// Client-side avatar color extraction handles this as fallback

		// Fetch guild member (includes roles)
		let member;
		try {
			member = await fetchGuildMember(tokens.access_token, getGuildId());
		} catch {
			error(403, 'You must be a member of the Pawtropolis server to access this dashboard.');
		}

		// Detect dashboard tier from roles
		const tier = detectTier(member.roles, user.id);
		if (tier === 'none') {
			error(403, 'You do not have a staff role in Pawtropolis. Access denied.');
		}

		// Create session
		setSession(cookies, {
			userId: user.id,
			username: user.username,
			globalName: user.global_name,
			avatar: user.avatar,
			banner: user.banner,
			accentColor: user.accent_color,
			avatarUrl: avatarUrl(user, 256),
			bannerUrl: bannerUrl(user, 600),
			tier,
			roles: member.roles,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: Date.now() + tokens.expires_in * 1000
		});

		redirect(302, '/dashboard');
	} catch (err) {
		// Re-throw SvelteKit errors (redirect, error)
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('OAuth2 callback error:', err);
		error(500, 'Authentication failed. Please try again.');
	}
};
