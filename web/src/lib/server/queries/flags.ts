import { db } from "$lib/server/db";
import { normalizeTimestamp } from "./shared";

export interface FlagItem {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  flagType: "nsfw" | "behavioral";
  reason: string;
  severity: "high" | "medium" | "low";
  nsfwScore: number | null;
  flaggedAt: number; // milliseconds
  flaggedBy: string | null;
  isManual: boolean;
  joinedAt: number | null; // milliseconds
  firstMessageAt: number | null; // milliseconds
  nsfwAvatarUrl: string | null; // the flagged avatar (NSFW only)
}

const SEVERITY_RANK: Record<FlagItem["severity"], number> = { high: 0, medium: 1, low: 2 };

/**
 * Merge flags from both nsfw_flags and user_activity tables.
 * Sorted by severity (high first) then date (newest first).
 */
export function getFlaggedUsers(guildId: string): FlagItem[] {
  // NSFW avatar flags (reviewed = 0 means pending)
  const nsfwRows = db()
    .prepare(
      `SELECT
				f.user_id,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(f.user_id, -6)) as display_name,
				u.avatar_url,
				f.avatar_url as nsfw_avatar_url,
				f.nsfw_score,
				f.reason,
				f.flagged_by,
				f.flagged_at,
				a.joined_at,
				a.first_message_at
			FROM nsfw_flags f
			LEFT JOIN user_cache u ON f.user_id = u.user_id AND u.guild_id = ?
			LEFT JOIN user_activity a ON f.user_id = a.user_id AND a.guild_id = ?
			WHERE f.guild_id = ? AND f.reviewed = 0`
    )
    .all(guildId, guildId, guildId) as {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    nsfw_avatar_url: string;
    nsfw_score: number;
    reason: string;
    flagged_by: string | null;
    flagged_at: string;
    joined_at: number | null;
    first_message_at: number | null;
  }[];

  // Behavioral/manual flags (flagged_at IS NOT NULL means active)
  const behavioralRows = db()
    .prepare(
      `SELECT
				a.user_id,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(a.user_id, -6)) as display_name,
				u.avatar_url,
				a.flagged_reason,
				a.flagged_by,
				a.flagged_at,
				a.manual_flag,
				a.joined_at,
				a.first_message_at
			FROM user_activity a
			LEFT JOIN user_cache u ON a.user_id = u.user_id AND u.guild_id = ?
			WHERE a.guild_id = ? AND a.flagged_at IS NOT NULL`
    )
    .all(guildId, guildId) as {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    flagged_reason: string | null;
    flagged_by: string | null;
    flagged_at: number;
    manual_flag: number;
    joined_at: number | null;
    first_message_at: number | null;
  }[];

  const flags: FlagItem[] = [];

  for (const r of nsfwRows) {
    const severity: FlagItem["severity"] =
      r.nsfw_score > 0.8 ? "high" : r.nsfw_score > 0.5 ? "medium" : "low";
    flags.push({
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      flagType: "nsfw",
      reason: r.reason,
      severity,
      nsfwScore: r.nsfw_score,
      flaggedAt: normalizeTimestamp(r.flagged_at) ?? Date.now(),
      flaggedBy: r.flagged_by,
      isManual: false,
      joinedAt: normalizeTimestamp(r.joined_at),
      firstMessageAt: normalizeTimestamp(r.first_message_at),
      nsfwAvatarUrl: r.nsfw_avatar_url,
    });
  }

  for (const r of behavioralRows) {
    flags.push({
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      flagType: "behavioral",
      reason: r.flagged_reason ?? "Flagged",
      severity: "low",
      nsfwScore: null,
      flaggedAt: normalizeTimestamp(r.flagged_at) ?? Date.now(),
      flaggedBy: r.flagged_by,
      isManual: r.manual_flag === 1,
      joinedAt: normalizeTimestamp(r.joined_at),
      firstMessageAt: normalizeTimestamp(r.first_message_at),
      nsfwAvatarUrl: null,
    });
  }

  // Sort: severity rank ascending (high first), then date descending (newest first)
  flags.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.flaggedAt - a.flaggedAt;
  });

  return flags;
}

/**
 * Get latest application status for a user (for flag detail context).
 */
export function getApplicationStatus(guildId: string, userId: string): string | null {
  const row = db()
    .prepare(
      `SELECT status FROM application
			 WHERE guild_id = ? AND user_id = ?
			 ORDER BY rowid DESC LIMIT 1`
    )
    .get(guildId, userId) as { status: string } | undefined;
  return row?.status ?? null;
}
