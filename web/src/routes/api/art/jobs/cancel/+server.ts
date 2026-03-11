import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'sm')) error(403, 'Insufficient permissions');

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { error(400, 'Invalid request body'); }

	const { jobId, reason } = body;
	if (!jobId) error(400, 'Missing jobId');

	const result = await callBotApi('/api/art/jobs/cancel', {
		userId: locals.user.id,
		tier: locals.user.tier,
		jobId,
		reason
	});

	if (!result.success) {
		const status_code = result.error?.includes('not found') ? 404 : 400;
		return json(result, { status: status_code });
	}
	return json(result);
};
