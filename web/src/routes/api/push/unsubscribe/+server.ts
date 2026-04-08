import { json, error, type RequestHandler } from '@sveltejs/kit';
import { removeSubscription } from '$lib/server/push/push-db';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}

	const endpoint = body.endpoint as string | undefined;
	if (!endpoint) {
		error(400, 'endpoint is required');
	}

	removeSubscription(endpoint);

	return json({ success: true });
};
