/**
 * SSE client store — manages a single EventSource connection to /api/sse.
 *
 * Svelte 5 runes-based. Exports reactive state and functions for
 * connect/disconnect, event subscriptions, and reconnect callbacks.
 */

import type { SSEEvent } from '$lib/types/events';

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

let _connectionStatus = $state<ConnectionStatus>('disconnected');

export function getConnectionStatus(): ConnectionStatus {
	return _connectionStatus;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1000;
let hasConnectedBefore = false;

const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 30_000;

type EventCallback = (event: SSEEvent) => void;
const subscribers = new Map<string, Set<EventCallback>>();
const reconnectCallbacks = new Set<() => void>();

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

/**
 * Subscribe to SSE events by pattern.
 * - `'review:*'` — wildcard: matches any event type starting with `review:`
 * - `'review:claimed'` — exact: matches only `review:claimed`
 */
export function subscribe(pattern: string, callback: EventCallback): void {
	let set = subscribers.get(pattern);
	if (!set) {
		set = new Set();
		subscribers.set(pattern, set);
	}
	set.add(callback);
}

/** Remove a previously registered subscription. */
export function unsubscribe(pattern: string, callback: EventCallback): void {
	const set = subscribers.get(pattern);
	if (set) {
		set.delete(callback);
		if (set.size === 0) subscribers.delete(pattern);
	}
}

/** Register a callback invoked after successful reconnection. */
export function onReconnect(callback: () => void): void {
	reconnectCallbacks.add(callback);
}

/** Remove a reconnect callback. */
export function offReconnect(callback: () => void): void {
	reconnectCallbacks.delete(callback);
}

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

function matchesPattern(pattern: string, eventType: string): boolean {
	if (pattern.endsWith(':*')) {
		return eventType.startsWith(pattern.slice(0, -1)); // 'review:*' → startsWith('review:')
	}
	return pattern === eventType;
}

function dispatch(event: SSEEvent): void {
	for (const [pattern, callbacks] of subscribers) {
		if (matchesPattern(pattern, event.type)) {
			for (const cb of callbacks) {
				cb(event);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

function scheduleReconnect(): void {
	if (reconnectTimer) return; // already scheduled

	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		createConnection();
	}, backoffMs);

	// Exponential backoff: double each time, cap at MAX_BACKOFF
	backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
}

function createConnection(): void {
	// Clean up any existing connection
	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}

	_connectionStatus = hasConnectedBefore ? 'reconnecting' : 'connecting';

	const source = new EventSource('/api/sse');

	source.onopen = () => {
		_connectionStatus = 'connected';
		backoffMs = MIN_BACKOFF; // reset backoff on success

		if (hasConnectedBefore) {
			// Fire reconnect callbacks for full state refresh
			for (const cb of reconnectCallbacks) {
				cb();
			}
		}
		hasConnectedBefore = true;
	};

	source.onmessage = (event) => {
		try {
			const parsed = JSON.parse(event.data) as SSEEvent;
			dispatch(parsed);
		} catch {
			// Malformed event data — silently ignore
		}
	};

	source.onerror = () => {
		// Connection lost — close and schedule reconnect with backoff
		source.close();
		eventSource = null;
		_connectionStatus = 'reconnecting';
		scheduleReconnect();
	};

	eventSource = source;
}

/** Open the SSE connection. Safe to call multiple times. */
export function connect(): void {
	if (eventSource) return; // already connected or connecting
	createConnection();
}

/** Close the SSE connection and clean up all timers. */
export function disconnect(): void {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}

	_connectionStatus = 'disconnected';
	backoffMs = MIN_BACKOFF;
	hasConnectedBefore = false;
}
