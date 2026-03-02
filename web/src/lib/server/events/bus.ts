/**
 * In-memory pub/sub event bus for SSE infrastructure.
 *
 * Receives events from the webhook receiver (/api/internal/events)
 * and distributes them to subscribers (fan-out.ts).
 *
 * No persistence, no replay buffer — MVP simplicity.
 */

import type { SSEEvent } from '$lib/types/events';

type EventCallback = (event: SSEEvent) => void;

class EventBus {
	private subscribers = new Set<EventCallback>();

	/** Publish an event to all subscribers */
	publish(event: SSEEvent): void {
		for (const callback of this.subscribers) {
			try {
				callback(event);
			} catch (err) {
				// Subscriber errors must not break other subscribers
				console.error('[EventBus] Subscriber error during', event.type, err);
			}
		}
	}

	/** Subscribe to all events */
	subscribe(callback: EventCallback): void {
		this.subscribers.add(callback);
	}

	/** Unsubscribe from events */
	unsubscribe(callback: EventCallback): void {
		this.subscribers.delete(callback);
	}

	/** Current subscriber count (useful for diagnostics) */
	get subscriberCount(): number {
		return this.subscribers.size;
	}
}

/** Singleton event bus instance */
export const eventBus = new EventBus();
