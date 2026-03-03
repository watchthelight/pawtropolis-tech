import { db } from '$lib/server/db';
import { normalizeTimestamp } from './shared';

// ---------------------------------------------------------------------------
// Modmail thread summary (collapsed view)
// ---------------------------------------------------------------------------

export interface ModmailMessageItem {
	id: number;
	direction: 'to_user' | 'to_staff';
	content: string;
	createdAt: number | null;
}

export interface ModmailThreadSummary {
	id: number;
	status: 'open' | 'closed';
	messageCount: number;
	latestMessage: string | null;
	latestDirection: 'to_user' | 'to_staff' | null;
	createdAt: number | null;
	messages: ModmailMessageItem[];
}

interface ThreadRow {
	id: number;
	status: string;
	created_at: string | null;
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

export function getModmailForApplication(userId: string, guildId: string): ModmailThreadSummary[] {
	const threads = db().prepare(`
		SELECT
			t.id,
			t.status,
			t.created_at,
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
	`).all(guildId, userId) as ThreadRow[];

	if (threads.length === 0) return [];

	// Batch-load all messages for discovered threads
	const ticketIds = threads.map((t) => t.id);
	const placeholders = ticketIds.map(() => '?').join(', ');
	const messages = db().prepare(`
		SELECT id, ticket_id, direction, content, created_at
		FROM modmail_message
		WHERE ticket_id IN (${placeholders})
		ORDER BY created_at ASC
	`).all(...ticketIds) as MessageRow[];

	// Group messages by ticket_id
	const messagesByTicket = new Map<number, ModmailMessageItem[]>();
	for (const msg of messages) {
		const items = messagesByTicket.get(msg.ticket_id) ?? [];
		items.push({
			id: msg.id,
			direction: msg.direction as 'to_user' | 'to_staff',
			content: msg.content ?? '',
			createdAt: normalizeTimestamp(msg.created_at)
		});
		messagesByTicket.set(msg.ticket_id, items);
	}

	return threads.map((row) => ({
		id: row.id,
		status: row.status as 'open' | 'closed',
		messageCount: row.message_count,
		latestMessage: row.latest_message,
		latestDirection: row.latest_direction as 'to_user' | 'to_staff' | null,
		createdAt: normalizeTimestamp(row.created_at),
		messages: messagesByTicket.get(row.id) ?? []
	}));
}
