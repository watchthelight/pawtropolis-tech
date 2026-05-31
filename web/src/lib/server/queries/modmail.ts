import { db } from "$lib/server/db";
import { normalizeTimestamp } from "./shared";

// ---------------------------------------------------------------------------
// Modmail thread list (dashboard page)
// ---------------------------------------------------------------------------

export interface ModmailListItem {
  id: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  appCode: string | null;
  status: "open" | "closed";
  messageCount: number;
  latestMessage: string | null;
  latestDirection: "to_user" | "to_staff" | null;
  createdAt: number | null;
  closedAt: number | null;
  hasUnread: boolean;
}

interface ListRow {
  id: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  app_code: string | null;
  status: string;
  message_count: number;
  latest_message: string | null;
  latest_direction: string | null;
  created_at: string | null;
  closed_at: string | null;
}

export function getModmailThreads(
  guildId: string,
  statusFilter: "open" | "closed" | "all" = "all",
  limit = 50
): ModmailListItem[] {
  const statusClause = statusFilter === "all" ? "" : `AND t.status = '${statusFilter}'`;

  const rows = db()
    .prepare(
      `
		SELECT
			t.id,
			t.user_id,
			COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(t.user_id, -6)) as username,
			u.avatar_url,
			t.app_code,
			t.status,
			COUNT(m.id) as message_count,
			lm.content as latest_message,
			lm.direction as latest_direction,
			t.created_at,
			t.closed_at
		FROM modmail_ticket t
		LEFT JOIN modmail_message m ON m.ticket_id = t.id
		LEFT JOIN modmail_message lm ON lm.id = (
			SELECT id FROM modmail_message
			WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
		)
		LEFT JOIN user_cache u ON u.guild_id = t.guild_id AND u.user_id = t.user_id
		WHERE t.guild_id = ? ${statusClause}
		GROUP BY t.id
		ORDER BY
			CASE WHEN t.status = 'open' THEN 0 ELSE 1 END ASC,
			t.created_at DESC
		LIMIT ?
	`
    )
    .all(guildId, limit) as ListRow[];

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url,
    appCode: row.app_code,
    status: row.status as "open" | "closed",
    messageCount: row.message_count,
    latestMessage: row.latest_message ? row.latest_message.slice(0, 120) : null,
    latestDirection: row.latest_direction as "to_user" | "to_staff" | null,
    createdAt: normalizeTimestamp(row.created_at),
    closedAt: normalizeTimestamp(row.closed_at),
    hasUnread: row.status === "open" && row.latest_direction === "to_staff",
  }));
}

export function getModmailStats(guildId: string): { open: number; closed: number; total: number } {
  const row = db()
    .prepare(
      `
		SELECT
			COUNT(*) as total,
			SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
			SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count
		FROM modmail_ticket WHERE guild_id = ?
	`
    )
    .get(guildId) as { total: number; open_count: number; closed_count: number };
  return { open: row.open_count, closed: row.closed_count, total: row.total };
}

// ---------------------------------------------------------------------------
// Modmail thread summary (collapsed view)
// ---------------------------------------------------------------------------

export interface ModmailMessageItem {
  id: number;
  direction: "to_user" | "to_staff";
  content: string;
  createdAt: number | null;
}

export interface ModmailThreadSummary {
  id: number;
  status: "open" | "closed";
  messageCount: number;
  latestMessage: string | null;
  latestDirection: "to_user" | "to_staff" | null;
  createdAt: number | null;
  closedAt: number | null;
  messages: ModmailMessageItem[];
}

interface ThreadRow {
  id: number;
  status: string;
  created_at: string | null;
  closed_at: string | null;
  message_count: number;
  latest_message: string | null;
  latest_direction: string | null;
}

interface MessageRow {
  id: number;
  ticket_id: number;
  direction: string;
  content: string | null;
  created_at: string | null;
}

/**
 * Single-thread fetch for the dashboard modmail viewer. Returns the thread
 * summary plus its messages and the resolved target user id (the applicant /
 * user whose modmail this is). Returns null if the ticket does not belong to
 * the supplied guild — protects against URL probing.
 */
export interface ModmailThreadDetail {
  thread: ModmailThreadSummary;
  userId: string;
  username: string;
  avatarUrl: string | null;
  appCode: string | null;
}

export function getModmailThreadDetail(
  guildId: string,
  ticketId: number
): ModmailThreadDetail | null {
  const t = db()
    .prepare(
      `
		SELECT
			t.id, t.user_id, t.app_code, t.status, t.created_at, t.closed_at,
			COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(t.user_id, -6)) AS username,
			u.avatar_url
		FROM modmail_ticket t
		LEFT JOIN user_cache u ON u.guild_id = t.guild_id AND u.user_id = t.user_id
		WHERE t.id = ? AND t.guild_id = ?
	`
    )
    .get(ticketId, guildId) as
    | {
        id: number;
        user_id: string;
        app_code: string | null;
        status: string;
        created_at: string | null;
        closed_at: string | null;
        username: string;
        avatar_url: string | null;
      }
    | undefined;
  if (!t) return null;

  const messages = db()
    .prepare(
      `
		SELECT id, direction, content, created_at
		FROM modmail_message
		WHERE ticket_id = ?
		ORDER BY created_at ASC
	`
    )
    .all(ticketId) as Array<{
    id: number;
    direction: string;
    content: string | null;
    created_at: string | null;
  }>;

  const items: ModmailMessageItem[] = messages.map((m) => ({
    id: m.id,
    direction: m.direction as "to_user" | "to_staff",
    content: m.content ?? "",
    createdAt: normalizeTimestamp(m.created_at),
  }));

  return {
    thread: {
      id: t.id,
      status: t.status as "open" | "closed",
      messageCount: items.length,
      latestMessage: items.length ? items[items.length - 1].content.slice(0, 120) : null,
      latestDirection: items.length ? items[items.length - 1].direction : null,
      createdAt: normalizeTimestamp(t.created_at),
      closedAt: normalizeTimestamp(t.closed_at),
      messages: items,
    },
    userId: t.user_id,
    username: t.username,
    avatarUrl: t.avatar_url,
    appCode: t.app_code,
  };
}

export function getModmailForApplication(userId: string, guildId: string): ModmailThreadSummary[] {
  const threads = db()
    .prepare(
      `
		SELECT
			t.id,
			t.status,
			t.created_at,
			t.closed_at,
			COUNT(m.id) as message_count,
			(SELECT content FROM modmail_message
			 WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_message,
			(SELECT direction FROM modmail_message
			 WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_direction
		FROM modmail_ticket t
		LEFT JOIN modmail_message m ON m.ticket_id = t.id
		WHERE t.guild_id = ? AND t.user_id = ?
		GROUP BY t.id
		ORDER BY t.created_at DESC
	`
    )
    .all(guildId, userId) as ThreadRow[];

  if (threads.length === 0) return [];

  // Batch-load all messages for discovered threads
  const ticketIds = threads.map((t) => t.id);
  const placeholders = ticketIds.map(() => "?").join(", ");
  const messages = db()
    .prepare(
      `
		SELECT id, ticket_id, direction, content, created_at
		FROM modmail_message
		WHERE ticket_id IN (${placeholders})
		ORDER BY created_at ASC
	`
    )
    .all(...ticketIds) as MessageRow[];

  // Group messages by ticket_id
  const messagesByTicket = new Map<number, ModmailMessageItem[]>();
  for (const msg of messages) {
    const items = messagesByTicket.get(msg.ticket_id) ?? [];
    items.push({
      id: msg.id,
      direction: msg.direction as "to_user" | "to_staff",
      content: msg.content ?? "",
      createdAt: normalizeTimestamp(msg.created_at),
    });
    messagesByTicket.set(msg.ticket_id, items);
  }

  return threads.map((row) => ({
    id: row.id,
    status: row.status as "open" | "closed",
    messageCount: row.message_count,
    latestMessage: row.latest_message,
    latestDirection: row.latest_direction as "to_user" | "to_staff" | null,
    createdAt: normalizeTimestamp(row.created_at),
    closedAt: normalizeTimestamp(row.closed_at),
    messages: messagesByTicket.get(row.id) ?? [],
  }));
}
