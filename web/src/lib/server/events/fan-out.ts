/**
 * Tier-filtered SSE client distribution.
 *
 * Manages connected SSE clients and broadcasts events from the bus
 * to qualifying clients based on their dashboard tier.
 *
 * Subscribes to eventBus on import — all published events flow here automatically.
 */

import crypto from "node:crypto";
import type { DashboardTier } from "$lib/server/roles";
import { hasMinTier } from "$lib/server/roles";
import type { SSEEvent, RoleChangedPayload } from "$lib/types/events";
import { getMinTierForEvent } from "$lib/types/events";
import { eventBus } from "./bus";

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
const MAX_CLIENTS = 200;

/** Generate a unique connection ID */
export function generateClientId(): string {
  return crypto.randomUUID();
}

/** Register a new SSE client connection. Returns false if at capacity. */
export function addClient(client: SSEClient): boolean {
  if (clients.size >= MAX_CLIENTS) {
    console.log(`[SSE] Client rejected (at capacity ${MAX_CLIENTS}): user=${client.userId}`);
    return false;
  }
  clients.set(client.id, client);
  console.log(
    `[SSE] Client connected: ${client.id} (user=${client.userId}, tier=${client.tier}, total=${clients.size})`
  );
  return true;
}

/** Remove a disconnected SSE client */
export function removeClient(id: string): void {
  const had = clients.delete(id);
  if (had) {
    console.log(`[SSE] Client disconnected: ${id} (total=${clients.size})`);
  }
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
  const isRoleChanged = event.type === "role:changed";

  // Fail-closed: unknown event domains (minTier === 'none') are dropped
  // unless they're role:changed which uses per-user filtering instead
  if (minTier === "none" && !isRoleChanged) return;

  // Serialize once — if the event can't be serialized, drop it
  let sseData: string;
  try {
    sseData = `data: ${JSON.stringify(event)}\n\n`;
  } catch (err) {
    console.error("[SSE] Failed to serialize event", event.type, err);
    return;
  }

  for (const client of clients.values()) {
    // Special case: role:changed only goes to the affected user
    if (isRoleChanged) {
      const payload = event.payload as RoleChangedPayload | null;
      if (payload?.userId === client.userId) {
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
    // Client stream errored — remove and log
    clients.delete(client.id);
    console.log(`[SSE] Client removed (send failed): ${client.id} (total=${clients.size})`);
  }
}

// ---------------------------------------------------------------------------
// Auto-subscribe to event bus
// ---------------------------------------------------------------------------

eventBus.subscribe(broadcast);
