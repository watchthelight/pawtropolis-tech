/**
 * Cookie consent state management.
 * Preference cookies (paw-style, paw-hue) are only set when consent is accepted.
 * The consent cookie itself is essential (records regulatory choice).
 */

const CONSENT_COOKIE = 'paw-consent';
const PREFERENCE_COOKIES = ['paw-style', 'paw-hue'] as const;
const ONE_YEAR = 60 * 60 * 24 * 365;

// ── Cookie helpers (client-side document.cookie) ──

function readCookie(name: string): string | null {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
	if (typeof document === 'undefined') return;
	const parts = [
		`${name}=${encodeURIComponent(value)}`,
		`path=/`,
		`max-age=${maxAge}`,
		`SameSite=Lax`
	];
	if (location.protocol === 'https:') parts.push('Secure');
	document.cookie = parts.join('; ');
}

export function deleteCookie(name: string): void {
	if (typeof document === 'undefined') return;
	const parts = [`${name}=`, 'path=/', 'max-age=0', 'SameSite=Lax'];
	if (location.protocol === 'https:') parts.push('Secure');
	document.cookie = parts.join('; ');
}

// ── Consent API ──

export type ConsentChoice = 'accepted' | 'denied';

/** Read the current consent state. Returns null if user hasn't chosen yet. */
export function getConsent(): ConsentChoice | null {
	const val = readCookie(CONSENT_COOKIE);
	if (val === 'accepted' || val === 'denied') return val;
	return null;
}

/** Record the user's consent choice. */
export function setConsent(choice: ConsentChoice): void {
	writeCookie(CONSENT_COOKIE, choice, ONE_YEAR);
	if (choice === 'denied') clearPreferenceCookies();
}

/** Whether preference cookies are allowed. */
export function hasConsent(): boolean {
	return getConsent() === 'accepted';
}

// ── Preference cookie API ──

/** Set a preference cookie (only if consent accepted). */
export function setPreferenceCookie(name: string, value: string): void {
	if (!hasConsent()) return;
	writeCookie(name, value, ONE_YEAR);
}

/** Read a preference cookie. */
export function getPreferenceCookie(name: string): string | null {
	return readCookie(name);
}

/** Remove all preference cookies. */
export function clearPreferenceCookies(): void {
	for (const name of PREFERENCE_COOKIES) {
		deleteCookie(name);
	}
}
