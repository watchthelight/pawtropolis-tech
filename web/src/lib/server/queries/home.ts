import { db } from "$lib/server/db";

export interface HomeMetrics {
  pending: number;
  pendingYours: number;
  activeClaims: number;
  decisionsToday: number;
  openModmail: number | null;

  // Command-center extras (mod tier+):
  nextActions: NextAction[];
  recentActivity: ActivityItem[];
  weekStats: { decisions: number; avgResponseMin: number | null };
}

export type NextActionKind = "unclaimed_app" | "unread_modmail" | "flagged_user" | "idle";

export interface NextAction {
  kind: NextActionKind;
  label: string; // Human-friendly button text
  subtitle: string; // Why it matters / context
  href: string; // Where Click goes
  weight: number; // Higher = more urgent
}

export interface ActivityItem {
  type: "decision" | "modmail";
  action: string; // approve/reject/kick or to_user/to_staff
  appId: string | null;
  ticketId: number | null;
  subjectName: string | null;
  createdAt: number; // unix seconds
  href: string;
}

function getTodayMidnightUnix(): number {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

function count(sql: string, ...params: unknown[]): number {
  return (
    db()
      .prepare(sql)
      .get(...params) as { count: number }
  ).count;
}

export function getHomeMetrics(
  userId: string,
  guildId: string,
  includeModTier: boolean
): HomeMetrics {
  // ── Personal queue (gk+) ──────────────────────────────────────────────
  const pending = count(
    "SELECT COUNT(*) as count FROM application WHERE guild_id = ? AND status IN (?, ?)",
    guildId,
    "submitted",
    "needs_info"
  );
  const pendingYours = count(
    `SELECT COUNT(*) as count FROM review_claim rc
		 JOIN application a ON rc.app_id = a.id
		 WHERE rc.reviewer_id = ? AND a.guild_id = ? AND a.status IN ('submitted', 'needs_info')`,
    userId,
    guildId
  );
  const activeClaims = count(
    "SELECT COUNT(*) as count FROM review_claim WHERE reviewer_id = ?",
    userId
  );
  const decisionsToday = count(
    `SELECT COUNT(*) as count FROM review_action
		 WHERE moderator_id = ? AND action IN ('approve', 'reject', 'kick') AND created_at >= ?`,
    userId,
    getTodayMidnightUnix()
  );

  // ── This week's stats (rolling 7d, mod+) ──────────────────────────────
  const weekStartS = Math.floor(Date.now() / 1000) - 7 * 86400;
  const weekRow = db()
    .prepare(
      `SELECT
			COUNT(*) AS decisions,
			AVG(ra.created_at - rc.claimed_at) AS avg_secs
		FROM review_action ra
		LEFT JOIN review_claim rc ON rc.app_id = ra.app_id AND rc.reviewer_id = ra.moderator_id
		WHERE ra.moderator_id = ? AND ra.action IN ('approve', 'reject', 'kick')
			AND ra.created_at >= ?`
    )
    .get(userId, weekStartS) as { decisions: number; avg_secs: number | null };
  const weekStats = {
    decisions: weekRow.decisions ?? 0,
    avgResponseMin: weekRow.avg_secs != null ? Math.round(weekRow.avg_secs / 60) : null,
  };

  let openModmail: number | null = null;
  const nextActions: NextAction[] = [];
  const recentActivity: ActivityItem[] = [];

  if (includeModTier) {
    openModmail = count(
      "SELECT COUNT(*) as count FROM modmail_ticket WHERE guild_id = ? AND status = 'open'",
      guildId
    );

    // ── Next-action candidates ────────────────────────────────────────
    // Priority: unread modmail (user is waiting) > stale unclaimed app > new app > flag
    const oldestUnreadModmail = db()
      .prepare(
        `SELECT t.id, t.user_id, t.app_code,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(t.user_id, -6)) AS name
			FROM modmail_ticket t
			LEFT JOIN modmail_message m ON m.ticket_id = t.id
			LEFT JOIN user_cache u ON u.guild_id = t.guild_id AND u.user_id = t.user_id
			WHERE t.guild_id = ? AND t.status = 'open'
			GROUP BY t.id
			HAVING SUM(CASE WHEN m.direction = 'to_staff' THEN 1 ELSE 0 END) > 0
				AND MAX(CASE WHEN m.direction = 'to_staff' THEN m.created_at ELSE NULL END)
				    > COALESCE(MAX(CASE WHEN m.direction = 'to_user' THEN m.created_at ELSE NULL END), '')
			ORDER BY t.created_at ASC
			LIMIT 1`
      )
      .get(guildId) as
      | { id: number; user_id: string; app_code: string | null; name: string }
      | undefined;

    const oldestUnclaimed = db()
      .prepare(
        `SELECT a.id, a.created_at,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(a.user_id, -6)) AS name
			FROM application a
			LEFT JOIN review_claim rc ON rc.app_id = a.id
			LEFT JOIN user_cache u ON u.guild_id = a.guild_id AND u.user_id = a.user_id
			WHERE a.guild_id = ? AND a.status IN ('submitted', 'needs_info') AND rc.app_id IS NULL
			ORDER BY a.created_at ASC
			LIMIT 1`
      )
      .get(guildId) as { id: string; created_at: string; name: string } | undefined;

    if (oldestUnreadModmail) {
      nextActions.push({
        kind: "unread_modmail",
        label: `Reply to ${oldestUnreadModmail.name}`,
        subtitle: "User is waiting on modmail.",
        href: `/dashboard/modmail/${oldestUnreadModmail.id}`,
        weight: 100,
      });
    }
    if (oldestUnclaimed) {
      const ageMs = Date.now() - new Date(oldestUnclaimed.created_at).getTime();
      const ageH = Math.round(ageMs / 3_600_000);
      nextActions.push({
        kind: "unclaimed_app",
        label: `Claim ${oldestUnclaimed.name}'s application`,
        subtitle:
          ageH >= 24
            ? `Stale — sat ${Math.round(ageH / 24)}d in queue.`
            : `Submitted ${ageH}h ago.`,
        href: `/dashboard/reviews/${oldestUnclaimed.id}`,
        weight: ageH >= 24 ? 90 : 70,
      });
    }
    nextActions.sort((a, b) => b.weight - a.weight);
    if (nextActions.length === 0) {
      nextActions.push({
        kind: "idle",
        label: "Inbox zero",
        subtitle: "Nothing waiting on you.",
        href: "/dashboard",
        weight: 0,
      });
    }

    // ── Recent activity feed (last 10 items by current mod) ───────────
    const recentDecisions = db()
      .prepare(
        `SELECT 'decision' AS type, ra.action, ra.app_id, NULL AS ticket_id, ra.created_at,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(a.user_id, -6)) AS subject_name
			FROM review_action ra
			JOIN application a ON a.id = ra.app_id
			LEFT JOIN user_cache u ON u.guild_id = a.guild_id AND u.user_id = a.user_id
			WHERE ra.moderator_id = ?
			ORDER BY ra.created_at DESC
			LIMIT 15`
      )
      .all(userId) as Array<{
      type: string;
      action: string;
      app_id: string;
      ticket_id: number | null;
      created_at: number;
      subject_name: string;
    }>;

    // modmail_message.created_at is text — convert via strftime in SQL.
    const recentModmail = db()
      .prepare(
        `SELECT 'modmail' AS type, m.direction AS action, NULL AS app_id, t.id AS ticket_id,
				CAST(strftime('%s', m.created_at) AS INTEGER) AS created_at,
				COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(t.user_id, -6)) AS subject_name
			FROM modmail_message m
			JOIN modmail_ticket t ON t.id = m.ticket_id
			LEFT JOIN user_cache u ON u.guild_id = t.guild_id AND u.user_id = t.user_id
			WHERE t.guild_id = ? AND m.direction = 'to_user'
			  AND COALESCE(m.thread_message_id, '') != ''
			ORDER BY m.created_at DESC
			LIMIT 15`
      )
      .all(guildId) as Array<{
      type: string;
      action: string;
      app_id: string | null;
      ticket_id: number;
      created_at: number;
      subject_name: string;
    }>;

    const merged = [...recentDecisions, ...recentModmail]
      .filter((r) => r.created_at)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 10);
    for (const r of merged) {
      recentActivity.push({
        type: r.type as "decision" | "modmail",
        action: r.action,
        appId: r.app_id,
        ticketId: r.ticket_id,
        subjectName: r.subject_name,
        createdAt: r.created_at,
        href:
          r.type === "decision" && r.app_id
            ? `/dashboard/reviews/${r.app_id}`
            : r.ticket_id
              ? `/dashboard/modmail/${r.ticket_id}`
              : "/dashboard",
      });
    }
  }

  return {
    pending,
    pendingYours,
    activeClaims,
    decisionsToday,
    openModmail,
    nextActions,
    recentActivity,
    weekStats,
  };
}
