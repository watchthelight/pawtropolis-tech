/**
 * Pawtropolis Tech — src/features/messageArchive.ts
 * WHAT: Buffered batch writer for messages_archive + message_reactions_archive.
 * WHY: One row per message (full content + URLs + edit/delete state) + one row
 *      per (message, emoji, user) for reactions. High-traffic batching avoids
 *      per-message fsync overhead.
 * FLOWS:
 *  - archiveMessage(msg, source) → buffer → flushed every 1s
 *  - markEdited(msg) / markDeleted(msg) → direct UPDATE (low rate)
 *  - addReaction / removeReaction → buffer → flush
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type {
  Message,
  PartialMessage,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

interface ArchiveRow {
  message_id: string;
  guild_id: string;
  channel_id: string;
  thread_id: string | null;
  author_id: string;
  author_name: string;
  author_is_bot: 0 | 1;
  content: string;
  attachments_json: string | null;
  embeds_json: string | null;
  reply_to_id: string | null;
  is_edited: 0 | 1;
  created_at_s: number;
  edited_at_s: number | null;
  ingest_source: "live" | "backfill";
}

interface ReactionRow {
  message_id: string;
  emoji: string;
  user_id: string;
  reacted_at_s: number | null;
  ingest_source: "live" | "backfill";
}

const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER = 5000;

const msgBuf: ArchiveRow[] = [];
const reactBuf: ReactionRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Serialize attachments to compact URL-only JSON */
function serializeAttachments(msg: Message | PartialMessage): string | null {
  if (!msg.attachments || msg.attachments.size === 0) return null;
  const urls: string[] = [];
  for (const a of msg.attachments.values()) urls.push(a.url);
  return JSON.stringify(urls);
}

function serializeEmbeds(msg: Message | PartialMessage): string | null {
  if (!msg.embeds || msg.embeds.length === 0) return null;
  // Strip down to lightweight representation: type + url + title
  const compact = msg.embeds.map((e) => ({
    type: e.data.type,
    url: e.data.url,
    title: e.data.title,
  }));
  return JSON.stringify(compact);
}

/** Encode reaction emoji into stable string form */
function emojiKey(reaction: MessageReaction | PartialMessageReaction): string {
  const e = reaction.emoji;
  if (e.id) return `<${e.animated ? "a" : ""}:${e.name ?? "_"}:${e.id}>`;
  return e.name ?? "?";
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

function flush(): void {
  flushTimer = null;
  if (msgBuf.length === 0 && reactBuf.length === 0) return;

  const msgs = msgBuf.splice(0, msgBuf.length);
  const reacts = reactBuf.splice(0, reactBuf.length);

  try {
    db.transaction(() => {
      if (msgs.length > 0) {
        const stmt = db.prepare(`
          INSERT INTO messages_archive (
            message_id, guild_id, channel_id, thread_id, author_id, author_name,
            author_is_bot, content, attachments_json, embeds_json, reply_to_id,
            is_edited, created_at_s, edited_at_s, ingest_source
          ) VALUES (
            @message_id, @guild_id, @channel_id, @thread_id, @author_id, @author_name,
            @author_is_bot, @content, @attachments_json, @embeds_json, @reply_to_id,
            @is_edited, @created_at_s, @edited_at_s, @ingest_source
          )
          ON CONFLICT(message_id) DO UPDATE SET
            content = excluded.content,
            attachments_json = excluded.attachments_json,
            embeds_json = excluded.embeds_json,
            is_edited = excluded.is_edited,
            edited_at_s = excluded.edited_at_s
        `);
        for (const m of msgs) stmt.run(m);
      }

      if (reacts.length > 0) {
        const rstmt = db.prepare(`
          INSERT OR IGNORE INTO message_reactions_archive (
            message_id, emoji, user_id, reacted_at_s, ingest_source
          ) VALUES (@message_id, @emoji, @user_id, @reacted_at_s, @ingest_source)
        `);
        for (const r of reacts) rstmt.run(r);
      }
    })();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such table: messages_archive")) {
      logger.debug("[archive] tables missing, migration 075 not yet applied");
      return;
    }
    logger.warn({ err, msgs: msgs.length, reacts: reacts.length }, "[archive] flush failed");
  }
}

export function archiveMessage(msg: Message, source: "live" | "backfill" = "live"): void {
  if (!msg.guildId) return;
  if (msgBuf.length >= MAX_BUFFER) {
    logger.warn({ bufferSize: msgBuf.length }, "[archive] msg buffer full, dropping oldest 10%");
    msgBuf.splice(0, Math.floor(MAX_BUFFER * 0.1));
  }
  msgBuf.push({
    message_id: msg.id,
    guild_id: msg.guildId,
    channel_id: msg.channelId,
    thread_id: msg.channel.isThread() ? msg.channelId : null,
    author_id: msg.author.id,
    author_name: msg.author.globalName ?? msg.author.username,
    author_is_bot: msg.author.bot ? 1 : 0,
    content: msg.content ?? "",
    attachments_json: serializeAttachments(msg),
    embeds_json: serializeEmbeds(msg),
    reply_to_id: msg.reference?.messageId ?? null,
    is_edited: msg.editedTimestamp ? 1 : 0,
    created_at_s: Math.floor(msg.createdTimestamp / 1000),
    edited_at_s: msg.editedTimestamp ? Math.floor(msg.editedTimestamp / 1000) : null,
    ingest_source: source,
  });
  scheduleFlush();
}

export function markMessageDeleted(msg: Message | PartialMessage): void {
  try {
    db.prepare(
      `UPDATE messages_archive SET is_deleted = 1, deleted_at_s = strftime('%s','now') WHERE message_id = ?`
    ).run(msg.id);
  } catch (err) {
    logger.debug({ err, id: msg.id }, "[archive] markDeleted failed");
  }
}

export function recordReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  source: "live" | "backfill" = "live"
): void {
  reactBuf.push({
    message_id: reaction.message.id,
    emoji: emojiKey(reaction),
    user_id: user.id,
    reacted_at_s: Math.floor(Date.now() / 1000),
    ingest_source: source,
  });
  scheduleFlush();
}

export function removeReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): void {
  try {
    db.prepare(
      `DELETE FROM message_reactions_archive WHERE message_id = ? AND emoji = ? AND user_id = ?`
    ).run(reaction.message.id, emojiKey(reaction), user.id);
  } catch (err) {
    logger.debug({ err }, "[archive] removeReaction failed");
  }
}

export function flushArchiveBuffersOnShutdown(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flush();
}

export type { ArchiveRow, ReactionRow };
