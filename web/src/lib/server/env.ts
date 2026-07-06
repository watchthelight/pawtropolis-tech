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
let _oauthRedirect: string | undefined;

export function getGuildId(): string {
  return (_guildId ??= getRequired("GUILD_ID"));
}

export function getSessionSecret(): string {
  return (_sessionSecret ??= getRequired("SESSION_SECRET"));
}

export function getOAuth2RedirectUri(): string {
  return (_oauthRedirect ??= getRequired("OAUTH2_REDIRECT_URI"));
}

/**
 * Cookie domain for the OAuth state cookie: the redirect URI's hostname, so
 * the cookie is shared across www and apex. Undefined for localhost dev
 * (browsers reject Domain=localhost).
 */
export function stateCookieDomain(): string | undefined {
  const host = new URL(getOAuth2RedirectUri()).hostname;
  return host === "localhost" || host === "127.0.0.1" ? undefined : host;
}
