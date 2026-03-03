/**
 * Cloudflare Worker: Discord Profile Proxy
 * Proxies /users/{id}/profile calls to Discord's API from Cloudflare edge IPs.
 * Discord blocks datacenter IPs (AWS) with error 40333 but allows Cloudflare edge.
 *
 * Auth: Requires PROXY_SECRET header matching the secret stored in CF Worker secrets.
 * The Discord user token is stored as a CF Worker secret (DISCORD_USER_TOKEN), never in code.
 */

interface Env {
	DISCORD_USER_TOKEN: string;
	PROXY_SECRET: string;
	ALLOWED_ORIGIN: string;
}

const DISCORD_API = 'https://discord.com/api/v9';

const SUPER_PROPERTIES = btoa(JSON.stringify({
	os: 'Windows',
	browser: 'Chrome',
	device: '',
	system_locale: 'en-US',
	browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
	browser_version: '145.0.0.0',
	os_version: '10',
	release_channel: 'stable',
	client_build_number: 503937,
}));

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
					'Access-Control-Allow-Methods': 'POST',
					'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
					'Access-Control-Max-Age': '86400',
				},
			});
		}

		if (request.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 });
		}

		// Verify proxy secret
		const secret = request.headers.get('X-Proxy-Secret');
		if (!secret || secret !== env.PROXY_SECRET) {
			return Response.json({ error: 'Unauthorized' }, { status: 401 });
		}

		if (!env.DISCORD_USER_TOKEN) {
			return Response.json({ error: 'DISCORD_USER_TOKEN not configured' }, { status: 500 });
		}

		let body: { targetUserId?: string; guildId?: string };
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: 'Invalid body' }, { status: 400 });
		}

		if (!body.targetUserId) {
			return Response.json({ error: 'targetUserId required' }, { status: 400 });
		}

		const guildId = body.guildId || '';
		const url = `${DISCORD_API}/users/${body.targetUserId}/profile?with_mutual_guilds=false&with_mutual_friends_count=false&guild_id=${guildId}`;

		try {
			const res = await fetch(url, {
				headers: {
					Authorization: env.DISCORD_USER_TOKEN,
					'X-Super-Properties': SUPER_PROPERTIES,
					'X-Discord-Locale': 'en-US',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
				},
			});

			if (!res.ok) {
				return Response.json(
					{ error: `Discord returned ${res.status}` },
					{
						status: res.status,
						headers: { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN },
					}
				);
			}

			const data: Record<string, unknown> = await res.json();

			// Extract only the fields we need — never forward raw Discord response
			const bio = (data.user_profile as Record<string, unknown>)?.bio || null;
			const activities = ((data.guild_member as Record<string, unknown>)?.activities ?? []) as Array<{
				type: number;
				emoji?: { name?: string };
				state?: string;
			}>;
			const custom = activities.find((a) => a.type === 4);
			const customStatus = custom
				? [custom.emoji?.name, custom.state].filter(Boolean).join(' ') || null
				: null;

			return Response.json(
				{ bio, customStatus },
				{
					headers: {
						'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
						'Cache-Control': 'private, max-age=60',
					},
				}
			);
		} catch (err) {
			return Response.json(
				{ error: 'Proxy fetch failed' },
				{
					status: 502,
					headers: { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN },
				}
			);
		}
	},
};
