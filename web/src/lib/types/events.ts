/**
 * SSE event type definitions for the dashboard real-time update system.
 *
 * Event flow: Bot → webhook POST → bus.ts → fan-out.ts → SSE → browser
 * Protocol: domain:action naming, typed payloads, Unix epoch timestamps
 */

import type { DashboardTier } from '$lib/server/roles';

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

export interface SSEEvent<T = unknown> {
	type: SSEEventType;
	payload: T;
	timestamp: number; // Unix epoch milliseconds
}

// ---------------------------------------------------------------------------
// MVP event types
// ---------------------------------------------------------------------------

export type SSEEventType =
	| 'review:submitted'
	| 'review:claimed'
	| 'review:unclaimed'
	| 'review:approved'
	| 'review:rejected'
	| 'review:kicked'
	| 'stats:updated'
	| 'role:changed';

// ---------------------------------------------------------------------------
// Typed payloads per event
// ---------------------------------------------------------------------------

export interface ReviewSubmittedPayload {
	appId: string;
	applicantName: string;
}

export interface ReviewClaimedPayload {
	appId: string;
	reviewerId: string;
	reviewerName: string;
}

export interface ReviewUnclaimedPayload {
	appId: string;
	reviewerId: string;
}

export interface ReviewDecidedPayload {
	appId: string;
	reviewerId: string;
	reviewerName: string;
	action: 'approve' | 'reject' | 'kick';
	reason?: string;
}

export interface StatsUpdatedPayload {
	userId: string;
}

export interface RoleChangedPayload {
	userId: string;
	newTier: DashboardTier;
	previousTier: DashboardTier;
}

// ---------------------------------------------------------------------------
// Event-to-payload type map (for type-safe consumption)
// ---------------------------------------------------------------------------

export interface SSEEventMap {
	'review:submitted': ReviewSubmittedPayload;
	'review:claimed': ReviewClaimedPayload;
	'review:unclaimed': ReviewUnclaimedPayload;
	'review:approved': ReviewDecidedPayload;
	'review:rejected': ReviewDecidedPayload;
	'review:kicked': ReviewDecidedPayload;
	'stats:updated': StatsUpdatedPayload;
	'role:changed': RoleChangedPayload;
}

// ---------------------------------------------------------------------------
// Tier-event visibility mapping
// ---------------------------------------------------------------------------

/**
 * Minimum tier required to receive each event domain.
 * `role:changed` is a special case — sent to all tiers but only for the
 * connected user's own userId (handled in fan-out, not here).
 */
export const EVENT_TIER_VISIBILITY: Record<string, DashboardTier> = {
	'review:': 'gk',
	'stats:': 'gk',
	'role:': 'gk',
	// Future domains
	'flag:': 'mod',
	'pulse:': 'mod',
	'system:': 'owner'
};

/**
 * Sorted prefixes — longest first so more specific prefixes match before broader ones.
 * Prevents insertion-order dependency in EVENT_TIER_VISIBILITY.
 */
const SORTED_PREFIXES = Object.entries(EVENT_TIER_VISIBILITY).sort(
	(a, b) => b[0].length - a[0].length
);

/**
 * Resolve the minimum tier for a given event type by matching its domain prefix.
 * Matches longest prefix first for specificity.
 * Returns 'none' if no matching domain found (event visible to nobody).
 */
export function getMinTierForEvent(eventType: string): DashboardTier {
	for (const [prefix, tier] of SORTED_PREFIXES) {
		if (eventType.startsWith(prefix)) return tier;
	}
	return 'none';
}
