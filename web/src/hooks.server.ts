import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/session';
import { getPreferences } from '$lib/server/preferences';

// Side-effect: subscribe push sender to eventBus
import '$lib/server/push/push-sender';

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

	// Read preference cookies for SSR theme injection (zero-flash)
	const prefs = getPreferences(event.cookies);

	return resolve(event, {
		transformPageChunk: ({ html }) => {
			const attrs: string[] = [];
			if (prefs.style && prefs.style !== 'default') {
				attrs.push(`data-style="${prefs.style}"`);
			}
			if (prefs.hue) {
				attrs.push(`style="--hue:${prefs.hue}"`);
			}
			if (attrs.length) {
				return html.replace('<html lang="en">', `<html lang="en" ${attrs.join(' ')}>`);
			}
			return html;
		}
	});
};
