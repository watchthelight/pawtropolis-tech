import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'gk')) error(403, 'Insufficient permissions');

	let body: { targetUserId?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	if (!body.targetUserId) error(400, 'targetUserId is required');

	const result = await callBotApi('/api/review/profile', {
		userId: locals.user.id,
		tier: locals.user.tier,
		targetUserId: body.targetUserId
	});

	if (!result.success) {
		const status = result.error.includes('not found') ? 404 : result.error.includes('unreachable') ? 502 : 400;
		return json(result, { status });
	}

	return json(result);
};
