import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'gk')) error(403, 'Insufficient permissions');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	const targetUserId = body.targetUserId as string | undefined;
	if (!targetUserId) error(400, 'targetUserId is required');

	const result = await callBotApi('/api/modmail/open', {
		userId: locals.user.id,
		tier: locals.user.tier,
		targetUserId,
		...(body.appCode ? { appCode: body.appCode } : {})
	});

	if (!result.success) {
		const errMsg = result.error.toLowerCase();
		let status = 400;
		if (errMsg.includes('not found') || errMsg.includes('not configured')) status = 404;
		else if (errMsg.includes('already has')) status = 409;
		else if (errMsg.includes('unreachable') || errMsg.includes('timed out')) status = 502;
		return json(result, { status });
	}

	return json(result);
};
