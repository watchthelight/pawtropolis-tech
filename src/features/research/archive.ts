/**
 * Pawtropolis Tech -- src/features/research/archive.ts
 * WHAT: Reads one channel out of messages_archive in the bot's database.
 * WHY: The archive already holds the main chat with its text, reply targets
 *      and deleted flags, so the research needs no copy of its own. That copy
 *      was what grew the database to 9.4 GB in May 2026.
 *
 *      The connection is read-only, and every statement is a short read of its
 *      own: nothing here keeps a transaction open while vectors are computed,
 *      so the bot's writes and checkpoints are never held up. src/db/db.ts is
 *      not imported on purpose: it opens the database for writing.
 *
 *      Every read goes through idx_msgarc_guild_time (guild, time), the one
 *      index the table kept after migration 085.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";

/** A message as the bookkeeping sees it, without its text. */
export interface ArchiveRow {
  messageId: string;
  authorId: string;
  createdAtS: number;
  isBot: boolean;
  isDeleted: boolean;
  hasText: boolean;
  /** Time of the last edit, 0 when never edited. A score is redone when it changes. */
  contentRev: number;
  replyToId: string | null;
}

/** A message that is not deleted, with its text. */
export interface ArchiveText {
  messageId: string;
  authorId: string;
  createdAtS: number;
  isBot: boolean;
  content: string;
  hasAttachment: boolean;
  hasEmbed: boolean;
  contentRev: number;
  replyToId: string | null;
}

interface Ordered {
  createdAtS: number;
  messageId: string;
}

/** Oldest first. Ids of one second are put in order by their number. */
export function byTimeThenId(a: Ordered, b: Ordered): number {
  return (
    a.createdAtS - b.createdAtS ||
    a.messageId.length - b.messageId.length ||
    (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0)
  );
}

const TEXT_COLUMNS = `message_id AS messageId, author_id AS authorId, created_at_s AS createdAtS,
  author_is_bot AS isBot, content, attachments_json IS NOT NULL AS hasAttachment,
  embeds_json IS NOT NULL AS hasEmbed, COALESCE(edited_at_s, 0) AS contentRev,
  reply_to_id AS replyToId`;

type Flags<T, K extends keyof T> = Omit<T, K> & Record<K, number>;
const toText = (r: Flags<ArchiveText, "isBot" | "hasAttachment" | "hasEmbed">): ArchiveText => ({
  ...r,
  isBot: r.isBot === 1,
  hasAttachment: r.hasAttachment === 1,
  hasEmbed: r.hasEmbed === 1,
});

export class Archive {
  private readonly db: Database.Database;

  constructor(
    file: string,
    private readonly guildId: string,
    private channelId = ""
  ) {
    this.db = new Database(file, { readonly: true, fileMustExist: true });
    this.db.pragma("busy_timeout = 5000");
  }

  /** The channel the guild configured as its general channel, if any. */
  generalChannel(): string | null {
    const hasConfig = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'guild_config'")
      .get();
    if (!hasConfig) return null;
    const row = this.db
      .prepare("SELECT general_channel_id AS id FROM guild_config WHERE guild_id = ?")
      .get(this.guildId) as { id: string | null } | undefined;
    return row?.id ?? null;
  }

  useChannel(channelId: string): void {
    this.channelId = channelId;
  }

  /** Time of the channel's first message, or null when it has none. */
  firstMessageAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT created_at_s AS t FROM messages_archive
         WHERE guild_id = ? AND channel_id = ? ORDER BY created_at_s LIMIT 1`
      )
      .get(this.guildId, this.channelId) as { t: number } | undefined;
    return row?.t ?? null;
  }

  /** Every message of the time range, deleted ones included, oldest first. */
  rows(fromS: number, toS: number): ArchiveRow[] {
    const found = this.db
      .prepare(
        `SELECT message_id AS messageId, author_id AS authorId, created_at_s AS createdAtS,
                author_is_bot AS isBot, is_deleted AS isDeleted, length(content) > 0 AS hasText,
                COALESCE(edited_at_s, 0) AS contentRev, reply_to_id AS replyToId
         FROM messages_archive
         WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ? AND channel_id = ?`
      )
      .all(this.guildId, fromS, toS, this.channelId) as Flags<
      ArchiveRow,
      "isBot" | "isDeleted" | "hasText"
    >[];
    return found
      .map((r) => ({
        ...r,
        isBot: r.isBot === 1,
        isDeleted: r.isDeleted === 1,
        hasText: r.hasText === 1,
      }))
      .sort(byTimeThenId);
  }

  /** The messages of the time range that are not deleted, with text, oldest first. */
  texts(fromS: number, toS: number): ArchiveText[] {
    const found = this.db
      .prepare(
        `SELECT ${TEXT_COLUMNS} FROM messages_archive
         WHERE guild_id = ? AND created_at_s >= ? AND created_at_s < ? AND channel_id = ?
           AND is_deleted = 0`
      )
      .all(this.guildId, fromS, toS, this.channelId) as Parameters<typeof toText>[0][];
    return found.map(toText).sort(byTimeThenId);
  }

  /** The last `count` messages before a time that are not deleted, oldest first. */
  lastBefore(beforeS: number, count: number): ArchiveText[] {
    // More than `count` are read because the index orders by second only: the
    // order inside the last second is settled here, by id.
    const found = this.db
      .prepare(
        `SELECT ${TEXT_COLUMNS} FROM messages_archive
         WHERE guild_id = ? AND created_at_s < ? AND channel_id = ? AND is_deleted = 0
         ORDER BY created_at_s DESC LIMIT ?`
      )
      .all(this.guildId, beforeS, this.channelId, count + 61) as Parameters<typeof toText>[0][];
    return found.map(toText).sort(byTimeThenId).slice(-count);
  }

  /** For every message of the channel that got a reply: how many, deleted replies not counted. */
  replyCounts(): Map<string, number> {
    const found = this.db
      .prepare(
        `SELECT reply_to_id AS id, COUNT(*) AS n FROM messages_archive
         WHERE guild_id = ? AND channel_id = ? AND is_deleted = 0 AND reply_to_id IS NOT NULL
         GROUP BY reply_to_id`
      )
      .all(this.guildId, this.channelId) as { id: string; n: number }[];
    return new Map(found.map((r) => [r.id, r.n]));
  }

  close(): void {
    this.db.close();
  }
}
