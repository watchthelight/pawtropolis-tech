/**
 * Bot status store — tracks whether the bot API is reachable.
 *
 * Goes offline only when a mutation API call explicitly fails with
 * "unreachable" or "timed out". Goes back online when any SSE event
 * arrives or a mutation succeeds.
 *
 * Does NOT use inactivity timers — a quiet server with no events
 * is not a dead bot.
 */

import { subscribe, unsubscribe, onReconnect, offReconnect } from '$lib/stores/sse.svelte';
import type { SSEEvent } from '$lib/types/events';

let _botOnline = $state(true);

export function getBotOnline(): boolean {
	return _botOnline;
}

/** Mark bot offline (called by mutation code on connection failure). */
export function setBotOffline(): void {
	_botOnline = false;
}

/** Mark bot online (called by mutation code on success). */
export function setBotOnline(): void {
	_botOnline = true;
}

// ---------------------------------------------------------------------------
// SSE-based recovery: any real event proves the bot is alive
// ---------------------------------------------------------------------------

function handleEvent(_event: SSEEvent): void {
	if (!_botOnline) {
		_botOnline = true;
	}
}

function handleReconnect(): void {
	// SSE reconnect means the web server is reachable; bot likely is too
	if (!_botOnline) {
		_botOnline = true;
	}
}

/**
 * Start monitoring bot health via SSE events.
 * Bot starts as "online" and only goes offline when a mutation fails.
 * Any SSE event brings it back online.
 */
export function startMonitoring(): void {
	subscribe('*', handleEvent);
	onReconnect(handleReconnect);
}

export function stopMonitoring(): void {
	unsubscribe('*', handleEvent);
	offReconnect(handleReconnect);
}
