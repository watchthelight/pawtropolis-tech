/**
 * Pawtropolis Tech — /api/backfill/stream
 * WHAT: Owner-only SSE endpoint that pushes backfill_stats + channel rows.
 * WHY: Live dashboard updates without polling overhead.
 */
import type { RequestHandler } from './$types';
import { hasMinTier } from '$lib/server/roles';
import { getBackfillStats, getBackfillChannels, getArchiveCounts } from '$lib/server/queries/backfill';

const TICK_MS = 1000;
const HEARTBEAT_MS = 25_000;

export const GET: RequestHandler = ({ locals }) => {
	const user = locals.user;
	if (!user || !hasMinTier(user.tier, 'owner')) {
		return new Response(JSON.stringify({ success: false, error: 'forbidden' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const encoder = new TextEncoder();
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			let lastChannelsHash = '';

			const send = (event: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					/* stream closed — cleanup runs in cancel() */
				}
			};

			const tick = () => {
				const stats = getBackfillStats();
				const counts = getArchiveCounts();
				send('stats', { ...stats, ...counts });

				// Channels change less often — only emit when something differs
				const channels = getBackfillChannels();
				const hash = JSON.stringify(channels.map((c) => [c.channelId, c.status, c.messagesFetched, c.reactionsFetched]));
				if (hash !== lastChannelsHash) {
					lastChannelsHash = hash;
					send('channels', channels);
				}
			};

			// initial push
			controller.enqueue(encoder.encode(':ok\n\n'));
			tick();

			tickTimer = setInterval(tick, TICK_MS);
			heartbeatTimer = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(':heartbeat\n\n'));
				} catch {
					if (heartbeatTimer) clearInterval(heartbeatTimer);
				}
			}, HEARTBEAT_MS);
		},
		cancel() {
			if (tickTimer) clearInterval(tickTimer);
			if (heartbeatTimer) clearInterval(heartbeatTimer);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
