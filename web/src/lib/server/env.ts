/**
 * Web dashboard environment validation.
 * Uses lazy getters so env vars are validated at first access (runtime), not at import/build time.
 */

function getRequired(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

let _guildId: string | undefined;
let _sessionSecret: string | undefined;

export function getGuildId(): string {
	return (_guildId ??= getRequired('GUILD_ID'));
}

export function getSessionSecret(): string {
	return (_sessionSecret ??= getRequired('SESSION_SECRET'));
}

export function getOAuth2RedirectUri(): string {
	return process.env.OAUTH2_REDIRECT_URI ?? '';
}
