import { db } from '$lib/server/db';
import { normalizeTimestamp } from './shared';

export interface ReviewQueueItem {
	id: string;
	userId: string;
	applicantName: string;
	status: string;
	submittedAt: number | null;
	claimedBy: string | null;
	claimedAt: number | null;
	riskScore: number;
}

interface ReviewQueueRow {
	id: string;
	user_id: string;
	applicant_name: string;
	status: string;
	submitted_at: string | null;
	reviewer_id: string | null;
	claimed_at: string | number | null;
	risk_score: number;
}

// ---------------------------------------------------------------------------
// Application detail
// ---------------------------------------------------------------------------

export interface ApplicationAnswer {
	question: string;
	answer: string;
}

export interface EvidenceEntry {
	tag: string;
	p: number;
}

export interface AvatarScanDetail {
	reason: string;
	evidenceHard: EvidenceEntry[];
	evidenceSoft: EvidenceEntry[];
	evidenceSafe: EvidenceEntry[];
}

export interface ApplicationDetail {
	id: string;
	userId: string;
	applicantName: string;
	avatarUrl: string | null;
	status: string;
	submittedAt: number | null;
	claimedBy: string | null;
	claimedAt: number | null;
	riskScore: number;
	scan: AvatarScanDetail | null;
	answers: ApplicationAnswer[];
}

interface AppDetailRow {
	id: string;
	user_id: string;
	applicant_name: string;
	avatar_url: string | null;
	status: string;
	submitted_at: string | null;
	reviewer_id: string | null;
	claimed_at: string | number | null;
	risk_score: number;
	scan_reason: string | null;
	scan_evidence_hard: string | null;
	scan_evidence_soft: string | null;
	scan_evidence_safe: string | null;
}

interface AppResponseRow {
	question: string;
	answer: string;
}

function parseEvidence(json: string | null): EvidenceEntry[] {
	if (!json) return [];
	try { return JSON.parse(json) as EvidenceEntry[]; }
	catch { return []; }
}

export function getApplicationDetail(appId: string, guildId: string): ApplicationDetail | null {
	const row = db().prepare(`
		SELECT
			a.id,
			a.user_id,
			a.status,
			a.submitted_at,
			COALESCE(u.global_name, u.username, 'Unknown') as applicant_name,
			u.avatar_url,
			c.reviewer_id,
			c.claimed_at,
			COALESCE(s.final_pct, 0) as risk_score,
			s.reason as scan_reason,
			s.evidence_hard as scan_evidence_hard,
			s.evidence_soft as scan_evidence_soft,
			s.evidence_safe as scan_evidence_safe
		FROM application a
		LEFT JOIN (
			SELECT guild_id, user_id, global_name, username, avatar_url,
				ROW_NUMBER() OVER (PARTITION BY guild_id, user_id ORDER BY created_at DESC) as rn
			FROM user_snapshot
		) u ON u.guild_id = a.guild_id AND u.user_id = a.user_id AND u.rn = 1
		LEFT JOIN review_claim c ON a.id = c.app_id
		LEFT JOIN avatar_scan s ON a.id = s.application_id
		WHERE a.id = ? AND a.guild_id = ?
	`).get(appId, guildId) as AppDetailRow | undefined;

	if (!row) return null;

	const responses = db().prepare(`
		SELECT question, answer
		FROM application_response
		WHERE app_id = ?
		ORDER BY q_index ASC
	`).all(appId) as AppResponseRow[];

	return {
		id: row.id,
		userId: row.user_id,
		applicantName: row.applicant_name,
		avatarUrl: row.avatar_url,
		status: row.status,
		submittedAt: normalizeTimestamp(row.submitted_at),
		claimedBy: row.reviewer_id,
		claimedAt: normalizeTimestamp(row.claimed_at),
		riskScore: row.risk_score,
		scan: row.scan_reason
			? {
				reason: row.scan_reason,
				evidenceHard: parseEvidence(row.scan_evidence_hard),
				evidenceSoft: parseEvidence(row.scan_evidence_soft),
				evidenceSafe: parseEvidence(row.scan_evidence_safe)
			}
			: null,
		answers: responses
	};
}

// ---------------------------------------------------------------------------
// Review history (resolved applications)
// ---------------------------------------------------------------------------

export interface ReviewHistoryItem {
	id: string;
	applicantName: string;
	status: string;
	resolvedAt: number | null;
	resolverId: string | null;
	reason: string | null;
}

interface HistoryRow {
	id: string;
	applicant_name: string;
	status: string;
	resolved_at: string | null;
	resolver_id: string | null;
	reason: string | null;
}

export function getReviewHistory(guildId: string, limit: number = 50): ReviewHistoryItem[] {
	const rows = db().prepare(`
		SELECT
			a.id,
			a.status,
			a.resolved_at,
			COALESCE(u.global_name, u.username, 'Unknown') as applicant_name,
			ra.moderator_id as resolver_id,
			ra.reason
		FROM application a
		LEFT JOIN (
			SELECT guild_id, user_id, global_name, username,
				ROW_NUMBER() OVER (PARTITION BY guild_id, user_id ORDER BY created_at DESC) as rn
			FROM user_snapshot
		) u ON u.guild_id = a.guild_id AND u.user_id = a.user_id AND u.rn = 1
		LEFT JOIN (
			SELECT app_id, moderator_id, reason,
				ROW_NUMBER() OVER (PARTITION BY app_id ORDER BY created_at DESC) as rn
			FROM review_action
			WHERE action IN ('approve', 'reject', 'perm_reject', 'kick')
		) ra ON ra.app_id = a.id AND ra.rn = 1
		WHERE a.guild_id = ? AND a.status IN ('approved', 'rejected', 'kicked')
		ORDER BY a.resolved_at DESC
		LIMIT ?
	`).all(guildId, limit) as HistoryRow[];

	return rows.map((row) => ({
		id: row.id,
		applicantName: row.applicant_name,
		status: row.status,
		resolvedAt: normalizeTimestamp(row.resolved_at),
		resolverId: row.resolver_id,
		reason: row.reason
	}));
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export function getReviewQueue(guildId: string): ReviewQueueItem[] {
	const rows = db().prepare(`
		SELECT
			a.id,
			a.user_id,
			a.status,
			a.submitted_at,
			COALESCE(u.global_name, u.username, 'Unknown') as applicant_name,
			c.reviewer_id,
			c.claimed_at,
			COALESCE(s.final_pct, 0) as risk_score
		FROM application a
		LEFT JOIN (
			SELECT guild_id, user_id, global_name, username,
				ROW_NUMBER() OVER (PARTITION BY guild_id, user_id ORDER BY created_at DESC) as rn
			FROM user_snapshot
		) u ON u.guild_id = a.guild_id AND u.user_id = a.user_id AND u.rn = 1
		LEFT JOIN review_claim c ON a.id = c.app_id
		LEFT JOIN avatar_scan s ON a.id = s.application_id
		WHERE a.guild_id = ? AND a.status IN ('submitted', 'needs_info')
		ORDER BY a.submitted_at DESC
	`).all(guildId) as ReviewQueueRow[];

	return rows.map((row) => ({
		id: row.id,
		userId: row.user_id,
		applicantName: row.applicant_name,
		status: row.status,
		submittedAt: normalizeTimestamp(row.submitted_at),
		claimedBy: row.reviewer_id,
		claimedAt: normalizeTimestamp(row.claimed_at),
		riskScore: row.risk_score
	}));
}
