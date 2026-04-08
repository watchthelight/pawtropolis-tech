import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';
import { getSession } from '$lib/server/session';
import { getPreferences } from '$lib/server/preferences';

// Side-effect: subscribe push sender to eventBus
import '$lib/server/push/push-sender';

// Sentry server-side init runs once at module load (server startup).
// Skipped silently if PUBLIC_SENTRY_DSN is unset, so dev/test environments
// without a DSN configured don't error out.
if (env.PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: env.PUBLIC_SENTRY_DSN,
		tracesSampleRate: 0.1,
		serverName: 'pawtropolis-web',
		environment: process.env.NODE_ENV || 'production'
	});
}

const appHandle: Handle = async ({ event, resolve }) => {
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

// Compose Sentry's handle wrapper with the app handle. Order matters:
// sentryHandle() must run first so it captures errors thrown by appHandle.
export const handle: Handle = sequence(Sentry.sentryHandle(), appHandle);

// Capture errors raised inside load functions and SSR rendering. Without this,
// thrown errors reach the user's browser but never make it to Sentry.
export const handleError: HandleServerError = Sentry.handleErrorWithSentry();
