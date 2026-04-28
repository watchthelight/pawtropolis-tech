/**
 * Pawtropolis Tech -- src/features/tickets/types.ts
 * WHAT: TypeScript types mirroring the ticket-system DB schema (migration 067).
 * WHY: Single source of truth for row shapes consumed by service, handlers, transcripts,
 *      and the web dashboard query layer. Parsed JSON columns get strongly-typed shapes
 *      so callers don't sprinkle JSON.parse + cast everywhere.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/** Ticket subjective lifecycle. closed is terminal — there is no reopen. */
export type TicketStatus = "open" | "closed";

/** Which panel embed surfaces a button for this type. */
export type PanelStack = "tickets" | "verification";

/** Discord button styles, matching discord.js ButtonStyle enum values. */
export type DiscordButtonStyle = 1 | 2 | 3 | 4; // primary | secondary | success | danger

/**
 * Emoji descriptor stored in ticket_type.button_emoji as JSON.
 * Custom guild emoji uses { name, id, animated? }; unicode glyphs use { name: '🎨' }.
 */
export type ButtonEmoji = {
  name: string;
  id?: string;
  animated?: boolean;
};

/** Permission overwrite template applied at channel-create time. */
export interface PermTemplate {
  /** Permissions denied to @everyone (typically just ViewChannel). */
  everyone_deny: string[];
  /** Roles granted access to the channel. */
  roles: Array<{ id: string; allow: string[] }>;
  /** Permissions allowed for the opener member overwrite. */
  opener_allow: string[];
  /** Permissions denied for the opener member overwrite. */
  opener_deny: string[];
}

/**
 * Strongly-typed view of a ticket_type row (after JSON cols parsed).
 */
export interface TicketTypeConfig {
  key: string;
  label: string;
  panelStack: PanelStack;
  panelPosition: number;
  buttonEmoji: ButtonEmoji | null;
  buttonStyle: DiscordButtonStyle;
  embedColor: number;
  numCounterKey: string;
  channelNameTemplate: string;
  greetingMd: string;
  pingRoleIds: string[];
  permTemplate: PermTemplate;
  hasStaffThread: boolean;
  isActive: boolean;
}

/** Raw DB row shape for ticket_type. Use only at the storage boundary. */
export interface TicketTypeRow {
  key: string;
  label: string;
  panel_stack: string;
  panel_position: number;
  button_emoji: string | null;
  button_style: number;
  embed_color: number;
  num_counter_key: string;
  channel_name_template: string;
  greeting_md: string;
  ping_role_ids: string;
  perm_template_json: string;
  has_staff_thread: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

/**
 * Strongly-typed view of a ticket row.
 */
export interface Ticket {
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
  /** NULL for our tickets; 'ticket_tool' for the 26 inherited legacy channels. */
  legacySource: string | null;
  openedAt: number;
  claimedAt: number | null;
  closedAt: number | null;
}

export interface TicketRow {
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
}

export type TicketEventType =
  | "opened"
  | "claimed"
  | "unclaimed"
  | "type-set"
  | "artist-assigned"
  | "reassigned"
  | "renamed"
  | "closed"
  | "archived";

export interface TicketEventRow {
  id: number;
  ticket_id: string;
  event_type: string;
  actor_user_id: string | null;
  payload_json: string | null;
  created_at: number;
}

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  in_thread: number;
  author_user_id: string;
  author_is_bot: number;
  content: string | null;
  embeds_json: string | null;
  reply_to_message_id: string | null;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

export interface TicketAttachmentRow {
  id: string;
  message_id: string;
  ticket_id: string;
  filename: string;
  mime: string | null;
  size_bytes: number;
  local_path: string | null;
  sha256: string | null;
  original_url: string;
  created_at: number;
}
