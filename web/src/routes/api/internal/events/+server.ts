/**
 * Webhook receiver for bot → dashboard event notifications.
 *
 * The bot POSTs events here after successful DB writes.
 * Events are published to the in-memory bus, which fans out to SSE clients.
 *
 * Authentication: X-Internal-Secret header must match INTERNAL_SECRET env var.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eventBus } from '$lib/server/events/bus';
import type { SSEEvent } from '$lib/types/events';

function getInternalSecret(): string {
	const secret = process.env.INTERNAL_SECRET;
	if (!secret) throw new Error('INTERNAL_SECRET environment variable is required');
	return secret;
}

export const POST: RequestHandler = async ({ request }) => {
	// Validate internal secret
	const providedSecret = request.headers.get('x-internal-secret');
	if (!providedSecret || providedSecret !== getInternalSecret()) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON' }, { status: 400 });
	}

	// Basic validation
	const event = body as SSEEvent;
	if (!event || typeof event.type !== 'string' || typeof event.timestamp !== 'number') {
		return json(
			{ success: false, error: 'Invalid event: type (string) and timestamp (number) required' },
			{ status: 400 }
		);
	}

	// Publish to bus — fan-out handles distribution to SSE clients
	eventBus.publish(event);

	return json({ success: true });
};
