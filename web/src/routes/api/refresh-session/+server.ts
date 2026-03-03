/**
 * Refresh session data from Discord API.
 * Re-fetches the user profile using the stored access token and updates
 * the session cookie if accent color, avatar, or display name changed.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchUser, avatarUrl, bannerUrl } from '$lib/server/discord';
import { getSession, setSession } from '$lib/server/session';

export const GET: RequestHandler = async ({ cookies }) => {
	const session = getSession(cookies);
	if (!session) {
		return json({ changed: false });
	}

	try {
		const user = await fetchUser(session.accessToken);

		const newAccentColor = user.accent_color ?? null;
		const newAvatarUrl = avatarUrl(user, 256);
		const newBannerUrl = bannerUrl(user, 600);
		const newGlobalName = user.global_name ?? null;

		const changed =
			newAccentColor !== session.accentColor ||
			newAvatarUrl !== session.avatarUrl ||
			newGlobalName !== session.globalName;

		if (changed) {
			setSession(cookies, {
				...session,
				accentColor: newAccentColor,
				avatar: user.avatar,
				banner: user.banner,
				avatarUrl: newAvatarUrl,
				bannerUrl: newBannerUrl,
				globalName: newGlobalName
			});
		}

		return json({
			changed,
			accentColor: newAccentColor,
			avatarUrl: newAvatarUrl,
			globalName: newGlobalName
		});
	} catch {
		// Token expired, rate limited, or network error — silently fail
		return json({ changed: false });
	}
};
