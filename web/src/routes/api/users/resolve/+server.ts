import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'gk')) error(403, 'Insufficient permissions');

	let body: { targetUserIds?: string[] };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	if (!body.targetUserIds?.length) error(400, 'targetUserIds is required');

	const result = await callBotApi('/api/users/resolve', {
		userId: locals.user.id,
		tier: locals.user.tier,
		targetUserIds: body.targetUserIds
	});

	if (!result.success) {
		const status = result.error.includes('unreachable') || result.error.includes('timed out') ? 502 : 400;
		return json(result, { status });
	}

	return json(result);
};
