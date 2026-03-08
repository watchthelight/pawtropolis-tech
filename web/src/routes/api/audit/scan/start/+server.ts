import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'admin')) error(403, 'Insufficient permissions');

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { error(400, 'Invalid request body'); }

	const { auditType, scope } = body;
	if (!auditType || (auditType !== 'members' && auditType !== 'nsfw')) {
		error(400, 'auditType must be "members" or "nsfw"');
	}

	const result = await callBotApi('/api/audit/scan/start', {
		userId: locals.user.id,
		tier: locals.user.tier,
		auditType,
		scope
	});

	if (!result.success) {
		return json(result, { status: result.error?.includes('permission') ? 403 : 400 });
	}
	return json(result);
};
