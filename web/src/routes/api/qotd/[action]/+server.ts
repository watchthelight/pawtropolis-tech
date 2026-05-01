import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier, type DashboardTier } from '$lib/server/roles';

const ACTIONS = new Set(['approve', 'reject', 'use', 'restore', 'edit'] as const);
type Action = 'approve' | 'reject' | 'use' | 'restore' | 'edit';

const MIN_TIER: Record<Action, DashboardTier> = {
	approve: 'gk',
	reject: 'gk',
	use: 'gk',
	restore: 'sm',
	edit: 'gk'
};

export const POST: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const action = params.action as Action;
	if (!ACTIONS.has(action)) error(404, `Unknown action: ${action}`);
	if (!hasMinTier(locals.user.tier, MIN_TIER[action])) error(403, 'Insufficient permissions');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const suggestionId = Number(body.suggestionId);
	if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
		error(400, 'suggestionId required');
	}

	const payload: Record<string, unknown> = {
		userId: locals.user.id,
		tier: locals.user.tier,
		suggestionId
	};
	if (action === 'reject' && typeof body.reason === 'string') payload.reason = body.reason;
	if (action === 'edit' && typeof body.question === 'string') payload.question = body.question;

	const result = await callBotApi(`/api/qotd/${action}`, payload);
	if (!result.success) {
		const msg = result.error.toLowerCase();
		let status = 400;
		if (msg.includes('not found')) status = 404;
		else if (msg.includes('not pending') || msg.includes('not approved') || msg.includes('not in a restorable')) status = 409;
		else if (msg.includes('unreachable') || msg.includes('timed out')) status = 502;
		return json(result, { status });
	}
	return json(result);
};
