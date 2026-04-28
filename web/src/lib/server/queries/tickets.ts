/**
 * Read-only queries for the dashboard /tickets tab.
 * Mirror schema from migrations 067 + 068.
 *
 * PRIVACY: Caller must enforce tier gate. Reports (report-user, report-staff)
 * are filtered out for non-mod tiers; this module exposes a `restrictReports`
 * flag so the page can pass it through cleanly.
 */

import { db } from '$lib/server/db';

export type TicketStatus = 'open' | 'closed';
export type TicketPanelStack = 'tickets' | 'verification';

export interface TicketRow {
	id: string;
	typeKey: string;
	number: number;
	channelId: string;
	staffThreadId: string | null;
	greetingMessageId: string | null;
	guildId: string;
	openerUserId: string;
	claimedByUserId: string | null;
	status: TicketStatus;
	closeReason: string | null;
	closedByUserId: string | null;
	archivePath: string | null;
	legacySource: string | null;
	openedAt: number;
	claimedAt: number | null;
	closedAt: number | null;
	// joined from ticket_type
	typeLabel: string;
	typeEmbedColor: number;
	typePanelStack: TicketPanelStack;
}

export interface TicketListFilters {
	typeKey?: string;
	status?: TicketStatus;
	search?: string;
	restrictReports: boolean; // true = exclude report-user / report-staff
}

export interface TicketListResult {
	rows: TicketRow[];
	total: number;
	page: number;
	pageSize: number;
}

const PAGE_SIZE = 50;

interface DbTicketRow {
	id: string;
	type_key: string;
	number: number;
	channel_id: string;
	staff_thread_id: string | null;
	greeting_message_id: string | null;
	guild_id: string;
	opener_user_id: string;
	claimed_by_user_id: string | null;
	status: string;
	close_reason: string | null;
	closed_by_user_id: string | null;
	archive_path: string | null;
	legacy_source: string | null;
	opened_at: number;
	claimed_at: number | null;
	closed_at: number | null;
	type_label: string;
	type_embed_color: number;
	type_panel_stack: string;
}

function mapRow(r: DbTicketRow): TicketRow {
	return {
		id: r.id,
		typeKey: r.type_key,
		number: r.number,
		channelId: r.channel_id,
		staffThreadId: r.staff_thread_id,
		greetingMessageId: r.greeting_message_id,
		guildId: r.guild_id,
		openerUserId: r.opener_user_id,
		claimedByUserId: r.claimed_by_user_id,
		status: r.status === 'closed' ? 'closed' : 'open',
		closeReason: r.close_reason,
		closedByUserId: r.closed_by_user_id,
		archivePath: r.archive_path,
		legacySource: r.legacy_source,
		openedAt: r.opened_at,
		claimedAt: r.claimed_at,
		closedAt: r.closed_at,
		typeLabel: r.type_label,
		typeEmbedColor: r.type_embed_color,
		typePanelStack:
			r.type_panel_stack === 'verification' ? 'verification' : 'tickets'
	};
}

export function listTickets(filters: TicketListFilters, page = 1): TicketListResult {
	const conditions: string[] = ['1 = 1'];
	const params: unknown[] = [];

	if (filters.typeKey) {
		conditions.push('t.type_key = ?');
		params.push(filters.typeKey);
	}
	if (filters.status) {
		conditions.push('t.status = ?');
		params.push(filters.status);
	}
	if (filters.search) {
		conditions.push(
			'(t.opener_user_id LIKE ? OR t.claimed_by_user_id LIKE ? OR CAST(t.number AS TEXT) LIKE ?)'
		);
		const wildcard = `%${filters.search}%`;
		params.push(wildcard, wildcard, wildcard);
	}
	if (filters.restrictReports) {
		conditions.push("t.type_key NOT IN ('report-user', 'report-staff')");
	}

	const whereSql = conditions.join(' AND ');
	const offset = Math.max(0, page - 1) * PAGE_SIZE;

	const totalRow = db()
		.prepare(`SELECT COUNT(*) AS c FROM ticket t WHERE ${whereSql}`)
		.get(...params) as { c: number };

	const rows = db()
		.prepare(
			`SELECT t.*, tt.label AS type_label, tt.embed_color AS type_embed_color,
			        tt.panel_stack AS type_panel_stack
			   FROM ticket t
			   JOIN ticket_type tt ON tt.key = t.type_key
			  WHERE ${whereSql}
			  ORDER BY t.opened_at DESC
			  LIMIT ${PAGE_SIZE} OFFSET ${offset}`
		)
		.all(...params) as DbTicketRow[];

	return {
		rows: rows.map(mapRow),
		total: totalRow.c,
		page,
		pageSize: PAGE_SIZE
	};
}

/** Distinct type_keys across the table — used for the filter dropdown. */
export function listTicketTypeKeys(restrictReports: boolean): string[] {
	const where = restrictReports ? "WHERE key NOT IN ('report-user', 'report-staff')" : '';
	const rows = db()
		.prepare(`SELECT key FROM ticket_type ${where} ORDER BY key`)
		.all() as { key: string }[];
	return rows.map((r) => r.key);
}
