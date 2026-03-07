import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	if (!hasMinTier(locals.user.tier, 'sm')) {
		error(403, 'Insufficient permissions');
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	const targetUserId = body.targetUserId as string | undefined;
	const flagType = body.flagType as string | undefined;

	if (!targetUserId || !flagType) {
		error(400, 'targetUserId and flagType are required');
	}

	if (flagType !== 'nsfw' && flagType !== 'behavioral') {
		error(400, 'flagType must be "nsfw" or "behavioral"');
	}

	// Discord snowflake validation
	if (!/^\d{17,20}$/.test(targetUserId)) {
		error(400, 'Invalid targetUserId format');
	}

	const result = await callBotApi('/api/flag/dismiss', {
		userId: locals.user.id,
		tier: locals.user.tier,
		targetUserId,
		flagType
	});

	if (!result.success) {
		const errMsg = result.error.toLowerCase();
		let status = 400;
		if (errMsg.includes('not found')) status = 404;
		else if (errMsg.includes('permission')) status = 403;
		else if (errMsg.includes('unreachable') || errMsg.includes('offline')) status = 502;
		return json(result, { status });
	}

	return json(result);
};
