/**
 * Bot status store — tracks whether the bot API is reachable.
 *
 * Separate from SSE connection status: SSE can be healthy while the bot
 * is offline (e.g., bot process crashed but web server is still running).
 *
 * Bot goes offline when: no SSE events for 60s after last event AND
 * a health check to the bot API fails.
 * Bot goes online when: any SSE event arrives after being offline, or reconnect.
 */

import { subscribe, unsubscribe, onReconnect, offReconnect } from '$lib/stores/sse.svelte';
import type { SSEEvent } from '$lib/types/events';

let _botOnline = $state(true);

export function getBotOnline(): boolean {
	return _botOnline;
}

export function setBotOffline(): void {
	_botOnline = false;
}

export function setBotOnline(): void {
	_botOnline = true;
}

// ---------------------------------------------------------------------------
// Inactivity monitoring
// ---------------------------------------------------------------------------

const INACTIVITY_TIMEOUT_MS = 60_000;

let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

function resetInactivityTimer(): void {
	if (inactivityTimer) clearTimeout(inactivityTimer);

	inactivityTimer = setTimeout(() => {
		// No events for 60s — mark bot offline
		_botOnline = false;
	}, INACTIVITY_TIMEOUT_MS);
}

function handleEvent(_event: SSEEvent): void {
	// Any event arriving means the bot is alive
	if (!_botOnline) {
		_botOnline = true;
	}
	resetInactivityTimer();
}

function handleReconnect(): void {
	// Reconnect implies the SSE server (and by extension the bot) is reachable
	_botOnline = true;
	resetInactivityTimer();
}

/**
 * Start monitoring bot health via SSE event activity.
 * Call from dashboard layout on mount.
 */
export function startMonitoring(): void {
	subscribe('*', handleEvent);
	onReconnect(handleReconnect);
	resetInactivityTimer();
}

/**
 * Stop monitoring and clean up timers.
 * Call from dashboard layout on unmount.
 */
export function stopMonitoring(): void {
	unsubscribe('*', handleEvent);
	offReconnect(handleReconnect);
	if (inactivityTimer) {
		clearTimeout(inactivityTimer);
		inactivityTimer = null;
	}
}
