import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';
import { ROLE_IDS } from '$lib/server/roles';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');

	// Artists can update their own jobs; staff can update any
	const isStaff = hasMinTier(locals.user.tier, 'sm');
	const isArtist = (locals.user.roles ?? []).includes(ROLE_IDS.SERVER_ARTIST);
	if (!isStaff && !isArtist) error(403, 'Insufficient permissions');

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { error(400, 'Invalid request body'); }

	const { jobId, status } = body;
	if (!jobId || !status) error(400, 'Missing required fields');

	const result = await callBotApi('/api/art/jobs/status', {
		userId: locals.user.id,
		tier: locals.user.tier,
		jobId,
		status
	});

	if (!result.success) {
		const status_code = result.error?.includes('not found') ? 404
			: result.error?.includes('own') ? 403 : 400;
		return json(result, { status: status_code });
	}
	return json(result);
};
