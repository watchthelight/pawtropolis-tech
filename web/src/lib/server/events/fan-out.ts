/**
 * Tier-filtered SSE client distribution.
 *
 * Manages connected SSE clients and broadcasts events from the bus
 * to qualifying clients based on their dashboard tier.
 *
 * Subscribes to eventBus on import — all published events flow here automatically.
 */

import crypto from 'node:crypto';
import type { DashboardTier } from '$lib/server/roles';
import { hasMinTier } from '$lib/server/roles';
import type { SSEEvent, RoleChangedPayload } from '$lib/types/events';
import { getMinTierForEvent } from '$lib/types/events';
import { eventBus } from './bus';

// ---------------------------------------------------------------------------
// SSE client types
// ---------------------------------------------------------------------------

export interface SSEClient {
	id: string;
	userId: string;
	tier: DashboardTier;
	send: (data: string) => void;
}

// ---------------------------------------------------------------------------
// Client registry
// ---------------------------------------------------------------------------

const clients = new Map<string, SSEClient>();

/** Generate a unique connection ID */
export function generateClientId(): string {
	return crypto.randomUUID();
}

/** Register a new SSE client connection */
export function addClient(client: SSEClient): void {
	clients.set(client.id, client);
}

/** Remove a disconnected SSE client */
export function removeClient(id: string): void {
	clients.delete(id);
}

/** Current connected client count (diagnostics) */
export function getClientCount(): number {
	return clients.size;
}

// ---------------------------------------------------------------------------
// Tier-filtered broadcast
// ---------------------------------------------------------------------------

/**
 * Broadcast an event to all connected clients whose tier permits seeing it.
 *
 * Special case: `role:changed` events are only sent to the user whose role
 * changed (payload.userId === client.userId), regardless of tier.
 */
function broadcast(event: SSEEvent): void {
	if (clients.size === 0) return;

	const minTier = getMinTierForEvent(event.type);
	const sseData = `data: ${JSON.stringify(event)}\n\n`;
	const isRoleChanged = event.type === 'role:changed';

	for (const client of clients.values()) {
		// Special case: role:changed only goes to the affected user
		if (isRoleChanged) {
			const payload = event.payload as RoleChangedPayload;
			if (payload.userId === client.userId) {
				safeSend(client, sseData);
			}
			continue;
		}

		// Standard tier check
		if (hasMinTier(client.tier, minTier)) {
			safeSend(client, sseData);
		}
	}
}

/** Send data to a client, removing them on write failure */
function safeSend(client: SSEClient, data: string): void {
	try {
		client.send(data);
	} catch {
		// Client stream errored — remove silently
		clients.delete(client.id);
	}
}

// ---------------------------------------------------------------------------
// Auto-subscribe to event bus
// ---------------------------------------------------------------------------

eventBus.subscribe(broadcast);
