/**
 * Pawtropolis Tech -- src/features/tickets/transcript.ts
 * WHAT: Captures Discord messages in ticket channels (and their staff threads)
 *       into the ticket_message table so they can be rendered as transcripts on
 *       the dashboard and embedded in close-time archives.
 * WHY: Discord CDN URLs expire on attachments and channel messages can be
 *      deleted. Mirroring authoritative state into our own DB lets us keep an
 *      auditable record long after a ticket closes.
 *
 * FILTERING: Only persists messages where the originating channel (or thread
 *            parent) maps to a tracked `ticket` row. Legacy Ticket Tool channels
 *            and unrelated guild messages are ignored at the earliest possible
 *            point to keep the listener cheap.
 *
 * ATTACHMENTS: Inserted here as ticket_attachment rows with local_path=NULL.
 *              The mirror downloader (P6b) populates local_path asynchronously.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type Message,
  type PartialMessage,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { enqueuePending } from "./attachments.js";
import type { Ticket, TicketRow } from "./types.js";

const findTicketByChannelStmt = db.prepare(
  `SELECT * FROM ticket WHERE channel_id = ?`
);

const findTicketByStaffThreadStmt = db.prepare(
  `SELECT * FROM ticket WHERE staff_thread_id = ?`
);

const upsertMessageStmt = db.prepare(
  `INSERT INTO ticket_message (
     id, ticket_id, in_thread, author_user_id, author_is_bot,
     content, embeds_json, reply_to_message_id, created_at, edited_at, deleted_at
   ) VALUES (
     @id, @ticket_id, @in_thread, @author_user_id, @author_is_bot,
     @content, @embeds_json, @reply_to_message_id, @created_at, @edited_at, NULL
   )
   ON CONFLICT(id) DO UPDATE SET
     content     = excluded.content,
     embeds_json = excluded.embeds_json,
     edited_at   = excluded.edited_at`
);

const markDeletedStmt = db.prepare(
  `UPDATE ticket_message SET deleted_at = ? WHERE id = ?`
);

const insertAttachmentStmt = db.prepare(
  `INSERT INTO ticket_attachment (
     id, message_id, ticket_id, filename, mime, size_bytes,
     local_path, sha256, original_url, created_at
   ) VALUES (
     @id, @message_id, @ticket_id, @filename, @mime, @size_bytes,
     NULL, NULL, @original_url, unixepoch()
   )
   ON CONFLICT(id) DO NOTHING`
);

function rowToTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    typeKey: row.type_key,
    number: row.number,
    channelId: row.channel_id,
    staffThreadId: row.staff_thread_id,
    greetingMessageId: row.greeting_message_id,
    guildId: row.guild_id,
    openerUserId: row.opener_user_id,
    claimedByUserId: row.claimed_by_user_id,
    status: row.status === "closed" ? "closed" : "open",
    closeReason: row.close_reason,
    closedByUserId: row.closed_by_user_id,
    archivePath: row.archive_path,
    legacySource: row.legacy_source,
    openedAt: row.opened_at,
    claimedAt: row.claimed_at,
    closedAt: row.closed_at,
  };
}

/**
 * Resolve the ticket associated with a message's channel. Returns:
 *   - {ticket, inThread:false} if message is in the ticket's main text channel
 *   - {ticket, inThread:true}  if message is in the ticket's staff thread
 *   - null if the message is unrelated to any tracked ticket
 *
 * The function does TWO lookups in the worst case (channel.id, then thread
 * staff lookup), but every read goes through prepared statements + indexes.
 */
function resolveTicketForMessage(
  msg: Message | PartialMessage
): { ticket: Ticket; inThread: boolean } | null {
  const channelId = msg.channelId;
  if (!channelId) return null;

  // 1. Direct hit: message is in the main ticket channel.
  let row = findTicketByChannelStmt.get(channelId) as TicketRow | undefined;
  if (row) {
    return { ticket: rowToTicket(row), inThread: false };
  }

  // 2. Message might be in the ticket's staff thread.
  row = findTicketByStaffThreadStmt.get(channelId) as TicketRow | undefined;
  if (row) {
    return { ticket: rowToTicket(row), inThread: true };
  }

  return null;
}

/** Trim Discord embed objects to a JSON-serializable subset for storage. */
function serializeEmbeds(msg: Message | PartialMessage): string | null {
  if (!msg.embeds || msg.embeds.length === 0) return null;
  const trimmed = msg.embeds.map((e) => ({
    type: e.data.type,
    title: e.title ?? null,
    description: e.description ?? null,
    url: e.url ?? null,
    color: e.color ?? null,
    fields: e.fields?.map((f) => ({ name: f.name, value: f.value, inline: f.inline })) ?? [],
    footer: e.footer ? { text: e.footer.text, iconURL: e.footer.iconURL ?? null } : null,
    image: e.image ? { url: e.image.url } : null,
    thumbnail: e.thumbnail ? { url: e.thumbnail.url } : null,
  }));
  return JSON.stringify(trimmed);
}

/** Insert/update ticket_message + capture attachment metadata rows. */
export function captureMessage(msg: Message | PartialMessage): void {
  if (!msg.id) return;
  if (msg.partial) {
    // Partial — author/content unknown. Skip for now; the next event (with full
    // payload) will catch it.
    return;
  }

  const resolved = resolveTicketForMessage(msg);
  if (!resolved) return;
  const { ticket, inThread } = resolved;

  try {
    upsertMessageStmt.run({
      id: msg.id,
      ticket_id: ticket.id,
      in_thread: inThread ? 1 : 0,
      author_user_id: msg.author?.id ?? "0",
      author_is_bot: msg.author?.bot ? 1 : 0,
      content: msg.content ?? null,
      embeds_json: serializeEmbeds(msg),
      reply_to_message_id: msg.reference?.messageId ?? null,
      created_at: Math.floor((msg.createdTimestamp ?? Date.now()) / 1000),
      edited_at: msg.editedTimestamp ? Math.floor(msg.editedTimestamp / 1000) : null,
    });
  } catch (err) {
    logger.warn(
      { err, ticketId: ticket.id, messageId: msg.id },
      "[tickets/transcript] upsert ticket_message failed"
    );
  }

  // Attachment metadata: insert rows with local_path=NULL, then enqueue for
  // background mirror. Discord CDN URLs expire ~24h so we hash + write to disk
  // and serve via dashboard proxy later.
  if (msg.attachments && msg.attachments.size > 0) {
    for (const [, att] of msg.attachments) {
      try {
        const result = insertAttachmentStmt.run({
          id: att.id,
          message_id: msg.id,
          ticket_id: ticket.id,
          filename: att.name ?? "unknown",
          mime: att.contentType ?? null,
          size_bytes: att.size,
          original_url: att.url,
        });
        if (result.changes > 0) {
          enqueuePending({
            id: att.id,
            ticketId: ticket.id,
            filename: att.name ?? "unknown",
            size: att.size,
            url: att.url,
          });
        }
      } catch (err) {
        logger.warn(
          { err, ticketId: ticket.id, attachmentId: att.id },
          "[tickets/transcript] insert ticket_attachment failed"
        );
      }
    }
  }
}

/** Mark a deleted message as soft-deleted. Preserves prior content. */
export function markMessageDeleted(msg: Message | PartialMessage): void {
  if (!msg.id) return;
  // Skip if not associated to a tracked ticket — but we may not have a
  // resolvable channel context (delete events sometimes carry partials).
  // Conservative: try resolving; if no hit, the row simply won't update.
  try {
    markDeletedStmt.run(Math.floor(Date.now() / 1000), msg.id);
  } catch (err) {
    logger.warn(
      { err, messageId: msg.id },
      "[tickets/transcript] mark deleted failed"
    );
  }
}
