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
	| 'review:permrejected'
	| 'stats:updated'
	| 'role:changed'
	| 'modmail:message_sent'
	| 'modmail:thread_opened'
	| 'modmail:thread_closed'
	| 'modmail:thread_reopened'
	| 'flag:created'
	| 'flag:dismissed'
	| 'flag:kicked'
	| 'audit:scan_started'
	| 'audit:scan_progress'
	| 'audit:scan_completed'
	| 'audit:scan_cancelled'
	| 'audit:security_snapshot'
	| 'audit:issue_acknowledged'
	| 'audit:issue_unacknowledged'
	| 'config:updated'
	| 'modmail:message_received'
	| 'review:stale'
	| 'review:queue_alert'
	| 'review:vote_out';

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
	action: 'approve' | 'reject' | 'kick' | 'perm_reject';
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

// Modmail payloads

export interface ModmailMessageSentPayload {
	ticketId: number;
	staffUserId: string;
}

export interface ModmailThreadOpenedPayload {
	ticketId: number;
	threadId: string;
	targetUserId: string;
	staffUserId: string;
}

export interface ModmailThreadClosedPayload {
	ticketId: number;
	staffUserId: string;
}

export interface ModmailThreadReopenedPayload {
	ticketId: number;
	threadId: string;
	staffUserId: string;
}

export interface FlagCreatedPayload {
	userId: string;
	flagType: 'nsfw' | 'behavioral';
	reason: string;
}

export interface FlagDismissedPayload {
	userId: string;
	flagType: 'nsfw' | 'behavioral';
}

export interface FlagKickedPayload {
	userId: string;
	kickedBy: string;
}

// Audit payloads

export interface AuditScanStartedPayload {
	sessionId: number;
	auditType: 'members' | 'nsfw';
	totalToScan: number;
	startedBy: string;
}

export interface AuditScanProgressPayload {
	sessionId: number;
	auditType: 'members' | 'nsfw';
	scannedCount: number;
	flaggedCount: number;
	totalToScan: number;
	apiCalls: number;
}

export interface AuditScanCompletedPayload {
	sessionId: number;
	auditType: 'members' | 'nsfw';
	scannedCount: number;
	flaggedCount: number;
}

export interface AuditScanCancelledPayload {
	sessionId: number;
	auditType: 'members' | 'nsfw';
}

export interface AuditSecuritySnapshotPayload {
	snapshotId: number;
	issueCount: number;
	criticalCount: number;
}

export interface AuditIssueAcknowledgedPayload {
	issueKey: string;
	acknowledgedBy: string;
}

export interface AuditIssueUnacknowledgedPayload {
	issueKey: string;
}

// Config payloads

export interface ConfigUpdatedPayload {
	fields: string[];
	updatedBy: string;
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
	'review:permrejected': ReviewDecidedPayload;
	'stats:updated': StatsUpdatedPayload;
	'role:changed': RoleChangedPayload;
	'modmail:message_sent': ModmailMessageSentPayload;
	'modmail:thread_opened': ModmailThreadOpenedPayload;
	'modmail:thread_closed': ModmailThreadClosedPayload;
	'modmail:thread_reopened': ModmailThreadReopenedPayload;
	'flag:created': FlagCreatedPayload;
	'flag:dismissed': FlagDismissedPayload;
	'flag:kicked': FlagKickedPayload;
	'audit:scan_started': AuditScanStartedPayload;
	'audit:scan_progress': AuditScanProgressPayload;
	'audit:scan_completed': AuditScanCompletedPayload;
	'audit:scan_cancelled': AuditScanCancelledPayload;
	'audit:security_snapshot': AuditSecuritySnapshotPayload;
	'audit:issue_acknowledged': AuditIssueAcknowledgedPayload;
	'audit:issue_unacknowledged': AuditIssueUnacknowledgedPayload;
	'config:updated': ConfigUpdatedPayload;
	'modmail:message_received': ModmailMessageReceivedPayload;
	'review:stale': ReviewStalePayload;
	'review:queue_alert': ReviewQueueAlertPayload;
	'review:vote_out': ReviewVoteOutPayload;
}

export interface ModmailMessageReceivedPayload {
	ticketId: string;
	userId: string;
	preview: string;
}

export interface ReviewStalePayload {
	appIds: string[];
	count: number;
	hoursOld: number;
}

export interface ReviewQueueAlertPayload {
	pendingCount: number;
	threshold: number;
}

export interface ReviewVoteOutPayload {
	appId: string;
	voterId: string;
	voterName: string;
	voteCount: number;
	threshold: number;
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
	'modmail:': 'gk',
	// Future domains
	'flag:': 'mod',
	'pulse:': 'mod',
	'audit:': 'admin',
	'config:': 'admin',
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
