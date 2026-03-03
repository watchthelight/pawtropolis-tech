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

	const ticketId = body.ticketId as number | undefined;
	if (!ticketId) error(400, 'ticketId is required');

	const result = await callBotApi('/api/modmail/reopen', {
		userId: locals.user.id,
		tier: locals.user.tier,
		ticketId
	});

	if (!result.success) {
		const errMsg = result.error.toLowerCase();
		let status = 400;
		if (errMsg.includes('not found')) status = 404;
		else if (errMsg.includes('already open')) status = 409;
		else if (errMsg.includes('more than 7 days')) status = 410;
		else if (errMsg.includes('unreachable') || errMsg.includes('timed out')) status = 502;
		return json(result, { status });
	}

	return json(result);
};
