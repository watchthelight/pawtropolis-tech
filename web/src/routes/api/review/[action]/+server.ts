import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

const VALID_ACTIONS = ['claim', 'unclaim', 'approve', 'reject', 'kick'] as const;
type ReviewAction = (typeof VALID_ACTIONS)[number];

const REASON_REQUIRED: ReviewAction[] = ['reject', 'kick'];

export const POST: RequestHandler = async ({ params, locals, request }) => {
	const action = params.action as string;

	if (!VALID_ACTIONS.includes(action as ReviewAction)) {
		error(404, 'Unknown review action');
	}

	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	if (!hasMinTier(locals.user.tier, 'gk')) {
		error(403, 'Insufficient permissions');
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	const appId = body.appId as string | undefined;
	if (!appId) {
		error(400, 'appId is required');
	}

	if (REASON_REQUIRED.includes(action as ReviewAction) && !body.reason) {
		error(400, 'reason is required for this action');
	}

	const botPath = `/api/review/${action}`;
	const result = await callBotApi(botPath, {
		userId: locals.user.id,
		tier: locals.user.tier,
		appId,
		...(body.reason ? { reason: body.reason } : {})
	});

	if (!result.success) {
		// Map error messages to appropriate HTTP status codes
		const errMsg = result.error.toLowerCase();
		let status = 400;
		if (errMsg.includes('not found')) status = 404;
		else if (errMsg.includes('already claimed') || errMsg.includes('claimed by another') || errMsg.includes('not claimed') || errMsg.includes('not in a reviewable')) status = 409;
		else if (errMsg.includes('permission') || errMsg.includes('insufficient')) status = 403;
		else if (errMsg.includes('unreachable') || errMsg.includes('timed out') || errMsg.includes('offline')) status = 502;
		return json(result, { status });
	}

	return json(result);
};
