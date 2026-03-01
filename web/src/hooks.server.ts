import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
	const session = getSession(event.cookies);

	if (session) {
		event.locals.user = {
			id: session.userId,
			username: session.username,
			globalName: session.globalName,
			avatarUrl: session.avatarUrl,
			bannerUrl: session.bannerUrl,
			accentColor: session.accentColor,
			tier: session.tier,
			roles: session.roles
		};
	}

	return resolve(event);
};
