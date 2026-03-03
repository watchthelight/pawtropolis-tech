/**
 * Refresh session data from Discord API.
 * Re-fetches the user profile using the stored access token and updates
 * the session cookie if accent color, avatar, or display name changed.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchUser, fetchGuildMember, avatarUrl, bannerUrl } from '$lib/server/discord';
import { detectTier } from '$lib/server/roles';
import { getSession, setSession } from '$lib/server/session';

const GUILD_ID = process.env.GUILD_ID!;

export const GET: RequestHandler = async ({ cookies }) => {
	const session = getSession(cookies);
	if (!session) {
		return json({ changed: false });
	}

	try {
		const [user, member] = await Promise.all([
			fetchUser(session.accessToken),
			fetchGuildMember(session.accessToken, GUILD_ID).catch(() => null)
		]);

		const newAccentColor = user.accent_color ?? null;
		const newAvatarUrl = avatarUrl(user, 256);
		const newBannerUrl = bannerUrl(user, 600);
		const newGlobalName = user.global_name ?? null;
		const newRoles = member?.roles ?? session.roles;
		const newTier = member ? detectTier(newRoles, user.id) : session.tier;

		const profileChanged =
			newAccentColor !== session.accentColor ||
			newAvatarUrl !== session.avatarUrl ||
			newGlobalName !== session.globalName;
		const tierChanged = newTier !== session.tier;
		const changed = profileChanged || tierChanged;

		if (changed) {
			setSession(cookies, {
				...session,
				accentColor: newAccentColor,
				avatar: user.avatar,
				banner: user.banner,
				avatarUrl: newAvatarUrl,
				bannerUrl: newBannerUrl,
				globalName: newGlobalName,
				roles: newRoles,
				tier: newTier
			});
		}

		return json({
			changed,
			tierChanged,
			accentColor: newAccentColor,
			avatarUrl: newAvatarUrl,
			globalName: newGlobalName,
			tier: newTier
		});
	} catch {
		// Token expired, rate limited, or network error — silently fail
		return json({ changed: false });
	}
};
