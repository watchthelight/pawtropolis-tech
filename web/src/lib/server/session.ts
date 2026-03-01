/**
 * Cookie-based session management.
 * Sessions are signed with SESSION_SECRET and stored as JSON in an httpOnly cookie.
 */

import { type Cookies } from '@sveltejs/kit';
import type { DashboardTier } from './roles';

const SESSION_COOKIE = 'pawtropolis_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionData {
	userId: string;
	username: string;
	globalName: string | null;
	avatar: string | null;
	banner: string | null;
	accentColor: number | null;
	avatarUrl: string;
	bannerUrl: string | null;
	tier: DashboardTier;
	roles: string[];
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

export function setSession(cookies: Cookies, data: SessionData): void {
	cookies.set(SESSION_COOKIE, JSON.stringify(data), {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: MAX_AGE
	});
}

export function getSession(cookies: Cookies): SessionData | null {
	const raw = cookies.get(SESSION_COOKIE);
	if (!raw) return null;

	try {
		return JSON.parse(raw) as SessionData;
	} catch {
		return null;
	}
}

export function clearSession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
