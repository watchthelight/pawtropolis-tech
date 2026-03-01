import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import crypto from 'node:crypto';

export const GET: RequestHandler = async ({ cookies }) => {
	const state = crypto.randomBytes(16).toString('hex');
	cookies.set('oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600 // 10 minutes
	});

	const params = new URLSearchParams({
		client_id: process.env.DISCORD_CLIENT_ID!,
		redirect_uri: process.env.OAUTH2_REDIRECT_URI!,
		response_type: 'code',
		scope: 'identify guilds.members.read',
		state,
		prompt: 'none'
	});

	redirect(302, `https://discord.com/api/oauth2/authorize?${params}`);
};
