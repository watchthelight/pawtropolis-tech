import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callBotApi } from '$lib/server/botApi';
import { hasMinTier } from '$lib/server/roles';

const VALID_SCAN_TYPES = ['nsfw', 'ai'] as const;

/** Extended timeout for scan operations — AI detection calls 4 APIs per image */
const SCAN_TIMEOUT_MS = 30_000;

export const POST: RequestHandler = async ({ params, locals }) => {
	const { appId, scanType } = params;

	if (!VALID_SCAN_TYPES.includes(scanType as (typeof VALID_SCAN_TYPES)[number])) {
		error(404, 'Unknown scan type');
	}

	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	if (!hasMinTier(locals.user.tier, 'gk')) {
		error(403, 'Insufficient permissions');
	}

	// UUID format validation
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId!)) {
		error(400, 'Invalid appId format');
	}

	const botPath = `/api/scan/${appId}/${scanType}`;
	const result = await callBotApi(botPath, {
		userId: locals.user.id,
		tier: locals.user.tier,
		appId
	}, SCAN_TIMEOUT_MS);

	if (!result.success) {
		const errMsg = result.error.toLowerCase();
		let status = 400;
		if (errMsg.includes('not found')) status = 404;
		else if (errMsg.includes('permission') || errMsg.includes('insufficient')) status = 403;
		else if (errMsg.includes('unreachable') || errMsg.includes('timed out') || errMsg.includes('offline')) status = 502;
		else if (errMsg.includes('failed')) status = 500;
		return json(result, { status });
	}

	return json(result);
};
