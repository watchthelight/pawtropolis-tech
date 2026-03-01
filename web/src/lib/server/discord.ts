/**
 * Discord API client for OAuth2 and guild member data.
 */

const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordUser {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	banner: string | null;
	accent_color: number | null;
}

export interface DiscordGuildMember {
	user: DiscordUser;
	nick: string | null;
	avatar: string | null;
	roles: string[];
	joined_at: string;
}

export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
	const response = await fetch(`${DISCORD_API}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: process.env.DISCORD_CLIENT_ID!,
			client_secret: process.env.DISCORD_CLIENT_SECRET!,
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri
		})
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Discord token exchange failed: ${response.status} ${text}`);
	}

	return response.json();
}

export async function fetchUser(accessToken: string): Promise<DiscordUser> {
	const response = await fetch(`${DISCORD_API}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) throw new Error(`Failed to fetch user: ${response.status}`);
	return response.json();
}

export async function fetchGuildMember(
	accessToken: string,
	guildId: string
): Promise<DiscordGuildMember> {
	const response = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) throw new Error(`Failed to fetch guild member: ${response.status}`);
	return response.json();
}

export function avatarUrl(user: DiscordUser, size = 256): string {
	if (!user.avatar) {
		const index = (BigInt(user.id) >> 22n) % 6n;
		return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
	}
	const ext = user.avatar.startsWith('a_') ? 'gif' : 'webp';
	return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
}

export function bannerUrl(user: DiscordUser, size = 600): string | null {
	if (!user.banner) return null;
	const ext = user.banner.startsWith('a_') ? 'gif' : 'webp';
	return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${ext}?size=${size}`;
}
