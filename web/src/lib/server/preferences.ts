/**
 * Server-side preference cookie reader.
 * Used in hooks.server.ts to inject theme attributes into SSR HTML.
 */

import type { Cookies } from '@sveltejs/kit';

const VALID_STYLES = ['default', 'neumorphism', 'glassmorphism', 'skeuomorphism'] as const;

export interface Preferences {
	style: string | null;
	hue: string | null;
}

export function getPreferences(cookies: Cookies): Preferences {
	const rawStyle = cookies.get('paw-style') ?? null;
	const rawHue = cookies.get('paw-hue') ?? null;

	const style = rawStyle && VALID_STYLES.includes(rawStyle as (typeof VALID_STYLES)[number])
		? rawStyle
		: null;

	// Hue must be a numeric string (0-360)
	const hue = rawHue && /^\d{1,3}$/.test(rawHue) && Number(rawHue) <= 360
		? rawHue
		: null;

	return { style, hue };
}
