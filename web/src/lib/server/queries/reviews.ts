import { db } from "$lib/server/db";
import { normalizeTimestamp } from "./shared";

export interface ReviewQueueItem {
  id: string;
  userId: string;
  applicantName: string;
  avatarUrl: string | null;
  status: string;
  submittedAt: number | null;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedByAvatar: string | null;
  claimedAt: number | null;
  riskScore: number;
  hasUnreadModmail: boolean;
  modmailAwaitingSince: number | null;
}

interface ReviewQueueRow {
  id: string;
  user_id: string;
  applicant_name: string;
  avatar_url: string | null;
  status: string;
  submitted_at: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  claimed_at: string | number | null;
  risk_score: number;
  has_unread_modmail: number;
  modmail_awaiting_since: string | number | null;
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
  claimedByName: string | null;
  claimedByAvatar: string | null;
  claimedAt: number | null;
  riskScore: number;
  scan: AvatarScanDetail | null;
  scanScores: ScanScores | null;
  answers: ApplicationAnswer[];
}

export interface ScanScores {
  avatarNsfwPct: number;
  bannerNsfwPct: number;
  avatarAiPct: number | null;
  bannerAiPct: number | null;
  bannerReason: string | null;
  bannerEvidenceHard: EvidenceEntry[];
  bannerEvidenceSoft: EvidenceEntry[];
  bannerEvidenceSafe: EvidenceEntry[];
}

interface AppDetailRow {
  id: string;
  user_id: string;
  applicant_name: string;
  avatar_url: string | null;
  status: string;
  submitted_at: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  claimed_at: string | number | null;
  risk_score: number;
  scan_reason: string | null;
  scan_evidence_hard: string | null;
  scan_evidence_soft: string | null;
  scan_evidence_safe: string | null;
  banner_final_pct: number | null;
  banner_reason: string | null;
  banner_evidence_hard: string | null;
  banner_evidence_soft: string | null;
  banner_evidence_safe: string | null;
  avatar_ai_score: number | null;
  banner_ai_score: number | null;
}

interface AppResponseRow {
  question: string;
  answer: string;
}

function parseEvidence(json: string | null): EvidenceEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is EvidenceEntry =>
        typeof e === "object" && e !== null && typeof e.tag === "string" && typeof e.p === "number"
    );
  } catch {
    return [];
  }
}

export function getApplicationDetail(appId: string, guildId: string): ApplicationDetail | null {
  const row = db()
    .prepare(
      `
		SELECT
			a.id,
			a.user_id,
			a.status,
			a.submitted_at,
			COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(a.user_id, -6)) as applicant_name,
			u.avatar_url,
			c.reviewer_id,
			COALESCE(ru.display_name, ru.global_name, ru.username) as reviewer_name,
			ru.avatar_url as reviewer_avatar_url,
			c.claimed_at,
			COALESCE(s.final_pct, 0) as risk_score,
			s.reason as scan_reason,
			s.evidence_hard as scan_evidence_hard,
			s.evidence_soft as scan_evidence_soft,
			s.evidence_safe as scan_evidence_safe,
			s.banner_final_pct,
			s.banner_reason,
			s.banner_evidence_hard,
			s.banner_evidence_soft,
			s.banner_evidence_safe,
			s.avatar_ai_score,
			s.banner_ai_score
		FROM application a
		LEFT JOIN user_cache u ON u.guild_id = a.guild_id AND u.user_id = a.user_id
		LEFT JOIN review_claim c ON a.id = c.app_id
		LEFT JOIN user_cache ru ON ru.guild_id = a.guild_id AND ru.user_id = c.reviewer_id
		LEFT JOIN avatar_scan s ON a.id = s.application_id
		WHERE a.id = ? AND a.guild_id = ?
	`
    )
    .get(appId, guildId) as AppDetailRow | undefined;

  if (!row) return null;

  const responses = db()
    .prepare(
      `
		SELECT question, answer
		FROM application_response
		WHERE app_id = ?
		ORDER BY q_index ASC
	`
    )
    .all(appId) as AppResponseRow[];

  return {
    id: row.id,
    userId: row.user_id,
    applicantName: row.applicant_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    submittedAt: normalizeTimestamp(row.submitted_at),
    claimedBy: row.reviewer_id,
    claimedByName: row.reviewer_name ?? null,
    claimedByAvatar: row.reviewer_avatar_url ?? null,
    claimedAt: normalizeTimestamp(row.claimed_at),
    riskScore: row.risk_score,
    scan: row.scan_reason
      ? {
          reason: row.scan_reason,
          evidenceHard: parseEvidence(row.scan_evidence_hard),
          evidenceSoft: parseEvidence(row.scan_evidence_soft),
          evidenceSafe: parseEvidence(row.scan_evidence_safe),
        }
      : null,
    scanScores:
      row.scan_reason ||
      row.banner_reason ||
      row.avatar_ai_score !== null ||
      row.banner_ai_score !== null
        ? {
            avatarNsfwPct: row.risk_score,
            bannerNsfwPct: row.banner_final_pct ?? 0,
            avatarAiPct:
              row.avatar_ai_score !== null ? Math.round(row.avatar_ai_score * 100) : null,
            bannerAiPct:
              row.banner_ai_score !== null ? Math.round(row.banner_ai_score * 100) : null,
            bannerReason: row.banner_reason,
            bannerEvidenceHard: parseEvidence(row.banner_evidence_hard),
            bannerEvidenceSoft: parseEvidence(row.banner_evidence_soft),
            bannerEvidenceSafe: parseEvidence(row.banner_evidence_safe),
          }
        : null,
    answers: responses,
  };
}

// ---------------------------------------------------------------------------
// Prior decisions for an applicant (ban/rejection history)
// ---------------------------------------------------------------------------

export interface PriorDecision {
  appId: string;
  status: string;
  action: string;
  reason: string | null;
  moderatorName: string | null;
  decidedAt: number | null;
}

interface PriorDecisionRow {
  app_id: string;
  status: string;
  action: string;
  reason: string | null;
  moderator_name: string | null;
  decided_at: number | null;
}

export function getUserPriorDecisions(
  userId: string,
  guildId: string,
  excludeAppId?: string
): PriorDecision[] {
  const rows = db()
    .prepare(
      `
		SELECT
			a.id as app_id,
			a.status,
			ra.action,
			ra.reason,
			COALESCE(mu.display_name, mu.global_name, mu.username) as moderator_name,
			ra.created_at as decided_at
		FROM application a
		INNER JOIN review_action ra ON ra.app_id = a.id
		LEFT JOIN user_cache mu ON mu.guild_id = a.guild_id AND mu.user_id = ra.moderator_id
		WHERE a.guild_id = ? AND a.user_id = ?
			AND a.id != ?
			AND ra.action IN ('reject', 'perm_reject', 'kick', 'approve')
		ORDER BY ra.created_at DESC
	`
    )
    .all(guildId, userId, excludeAppId ?? "") as PriorDecisionRow[];

  return rows.map((row) => ({
    appId: row.app_id,
    status: row.status,
    action: row.action,
    reason: row.reason,
    moderatorName: row.moderator_name ?? null,
    decidedAt: row.decided_at ? row.decided_at * 1000 : null,
  }));
}

// ---------------------------------------------------------------------------
// Applicant profile (cached from user_cache)
// ---------------------------------------------------------------------------

export interface CachedProfile {
  bannerUrl: string | null;
  accentColor: number | null;
  joinedAt: number | null;
  createdAt: number | null;
}

export function getCachedProfile(userId: string, guildId: string): CachedProfile | null {
  const row = db()
    .prepare(
      `
		SELECT banner_url, accent_color, joined_at, created_at
		FROM user_cache
		WHERE user_id = ? AND guild_id = ?
	`
    )
    .get(userId, guildId) as
    | {
        banner_url: string | null;
        accent_color: number | null;
        joined_at: number | null;
        created_at: number | null;
      }
    | undefined;

  if (!row) return null;
  return {
    bannerUrl: row.banner_url,
    accentColor: row.accent_color,
    joinedAt: row.joined_at ? row.joined_at * 1000 : null,
    createdAt: row.created_at ? row.created_at * 1000 : null,
  };
}

// ---------------------------------------------------------------------------
// Review history (resolved applications)
// ---------------------------------------------------------------------------

export interface ReviewHistoryItem {
  id: string;
  applicantName: string;
  avatarUrl: string | null;
  status: string;
  resolvedAt: number | null;
  resolverId: string | null;
  resolverName: string | null;
  reason: string | null;
}

interface HistoryRow {
  id: string;
  applicant_name: string;
  avatar_url: string | null;
  status: string;
  resolved_at: string | null;
  resolver_id: string | null;
  resolver_name: string | null;
  reason: string | null;
}

export function getReviewHistory(guildId: string, limit: number = 50): ReviewHistoryItem[] {
  const rows = db()
    .prepare(
      `
		SELECT
			a.id,
			a.status,
			a.resolved_at,
			COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(a.user_id, -6)) as applicant_name,
			u.avatar_url,
			ra.moderator_id as resolver_id,
			COALESCE(mu.display_name, mu.global_name, mu.username) as resolver_name,
			ra.reason
		FROM application a
		LEFT JOIN user_cache u ON u.guild_id = a.guild_id AND u.user_id = a.user_id
		LEFT JOIN (
			SELECT app_id, moderator_id, reason,
				ROW_NUMBER() OVER (PARTITION BY app_id ORDER BY created_at DESC) as rn
			FROM review_action
			WHERE action IN ('approve', 'reject', 'perm_reject', 'kick')
		) ra ON ra.app_id = a.id AND ra.rn = 1
		LEFT JOIN user_cache mu ON mu.guild_id = a.guild_id AND mu.user_id = ra.moderator_id
		WHERE a.guild_id = ? AND a.status IN ('approved', 'rejected', 'kicked')
		ORDER BY a.resolved_at DESC
		LIMIT ?
	`
    )
    .all(guildId, limit) as HistoryRow[];

  return rows.map((row) => ({
    id: row.id,
    applicantName: row.applicant_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    resolvedAt: normalizeTimestamp(row.resolved_at),
    resolverId: row.resolver_id,
    resolverName: row.resolver_name ?? null,
    reason: row.reason,
  }));
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export function getReviewQueue(guildId: string): ReviewQueueItem[] {
  const rows = db()
    .prepare(
      `
		SELECT
			a.id,
			a.user_id,
			a.status,
			a.submitted_at,
			COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(a.user_id, -6)) as applicant_name,
			u.avatar_url,
			c.reviewer_id,
			COALESCE(ru.display_name, ru.global_name, ru.username) as reviewer_name,
			ru.avatar_url as reviewer_avatar_url,
			c.claimed_at,
			COALESCE(s.final_pct, 0) as risk_score,
			EXISTS (
				SELECT 1 FROM modmail_ticket mt
				INNER JOIN modmail_message mm ON mm.ticket_id = mt.id
				WHERE mt.guild_id = a.guild_id AND mt.user_id = a.user_id
					AND mt.status = 'open'
					AND mm.id = (SELECT MAX(mm2.id) FROM modmail_message mm2 WHERE mm2.ticket_id = mt.id)
					AND mm.direction = 'to_staff'
			) as has_unread_modmail,
			(
				SELECT mm.created_at FROM modmail_ticket mt
				INNER JOIN modmail_message mm ON mm.ticket_id = mt.id
				WHERE mt.guild_id = a.guild_id AND mt.user_id = a.user_id
					AND mt.status = 'open'
					AND mm.id = (SELECT MAX(mm2.id) FROM modmail_message mm2 WHERE mm2.ticket_id = mt.id)
					AND mm.direction = 'to_user'
			) as modmail_awaiting_since
		FROM application a
		LEFT JOIN user_cache u ON u.guild_id = a.guild_id AND u.user_id = a.user_id
		LEFT JOIN review_claim c ON a.id = c.app_id
		LEFT JOIN user_cache ru ON ru.guild_id = a.guild_id AND ru.user_id = c.reviewer_id
		LEFT JOIN avatar_scan s ON a.id = s.application_id
		WHERE a.guild_id = ? AND a.status IN ('submitted', 'needs_info')
		ORDER BY
			-- Unclaimed before claimed (unclaimed need attention)
			CASE WHEN c.reviewer_id IS NULL THEN 0 ELSE 1 END ASC,
			-- Flagged/high-risk applications first (risk_score > 50%)
			CASE WHEN COALESCE(s.final_pct, 0) > 50 THEN 0 ELSE 1 END ASC,
			-- Unread modmail needs response
			CASE WHEN EXISTS (
				SELECT 1 FROM modmail_ticket mt2
				INNER JOIN modmail_message mm3 ON mm3.ticket_id = mt2.id
				WHERE mt2.guild_id = a.guild_id AND mt2.user_id = a.user_id
					AND mt2.status = 'open'
					AND mm3.id = (SELECT MAX(mm4.id) FROM modmail_message mm4 WHERE mm4.ticket_id = mt2.id)
					AND mm3.direction = 'to_staff'
			) THEN 0 ELSE 1 END ASC,
			-- Oldest first within each priority group
			a.submitted_at ASC
	`
    )
    .all(guildId) as ReviewQueueRow[];

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    applicantName: row.applicant_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    submittedAt: normalizeTimestamp(row.submitted_at),
    claimedBy: row.reviewer_id,
    claimedByName: row.reviewer_name ?? null,
    claimedByAvatar: row.reviewer_avatar_url ?? null,
    claimedAt: normalizeTimestamp(row.claimed_at),
    riskScore: row.risk_score,
    hasUnreadModmail: Boolean(row.has_unread_modmail),
    modmailAwaitingSince: normalizeTimestamp(row.modmail_awaiting_since),
  }));
}

// ---------------------------------------------------------------------------
// Vote Out info
// ---------------------------------------------------------------------------

export interface VoteOutVoter {
  id: string;
  name: string;
  reason: string | null;
}

export interface VoteOutInfo {
  count: number;
  threshold: number;
  voters: VoteOutVoter[];
}

export function getVoteOutInfo(appId: string, guildId: string): VoteOutInfo {
  const cfgRow = db()
    .prepare("SELECT vote_out_threshold FROM guild_config WHERE guild_id = ?")
    .get(guildId) as { vote_out_threshold: number | null } | undefined;
  const threshold = cfgRow?.vote_out_threshold ?? 2;

  const voters = db()
    .prepare(
      `
		SELECT
			vo.voter_id as id,
			COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(vo.voter_id, -6)) as name,
			vo.reason as reason
		FROM vote_out vo
		LEFT JOIN user_cache u ON u.user_id = vo.voter_id AND u.guild_id = ?
		WHERE vo.app_id = ?
		ORDER BY vo.created_at ASC
	`
    )
    .all(guildId, appId) as VoteOutVoter[];

  return { count: voters.length, threshold, voters };
}
