/**
 * Pawtropolis Tech -- src/features/tickets/service.ts
 * WHAT: TicketService — lifecycle methods for first-party tickets.
 *       This phase ships create() only; claim/close/rename/reassignArtist
 *       follow in the next phase.
 * WHY: Centralizes channel creation, permission overwrite assembly, greeting
 *      posting, staff thread spawn, and DB row inserts in a single auditable
 *      function. Every interaction handler can call this without re-implementing
 *      the dance.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { randomUUID } from "node:crypto";
import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type Guild,
  type TextChannel,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { getTicketsCategoryId } from "./config.js";
import { allocateNextNumber } from "./counters.js";
import { buildTicketOverwrites } from "./permissions.js";
import { getTicketType } from "./registry.js";
import {
  buildGreetingActionRow,
  buildGreetingEmbed,
  formatChannelName,
} from "./rendering.js";
import type { Ticket, TicketRow } from "./types.js";

const insertTicketStmt = db.prepare(
  `INSERT INTO ticket (
     id, type_key, number, channel_id, staff_thread_id, guild_id,
     opener_user_id, claimed_by_user_id, status, close_reason,
     closed_by_user_id, archive_path, legacy_source,
     opened_at, claimed_at, closed_at
   ) VALUES (
     @id, @type_key, @number, @channel_id, @staff_thread_id, @guild_id,
     @opener_user_id, NULL, 'open', NULL, NULL, NULL, NULL,
     @opened_at, NULL, NULL
   )`
);

const insertEventStmt = db.prepare(
  `INSERT INTO ticket_event (ticket_id, event_type, actor_user_id, payload_json, created_at)
   VALUES (?, ?, ?, ?, unixepoch())`
);

const setStaffThreadStmt = db.prepare(`UPDATE ticket SET staff_thread_id = ? WHERE id = ?`);

function rowToTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    typeKey: row.type_key,
    number: row.number,
    channelId: row.channel_id,
    staffThreadId: row.staff_thread_id,
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

export interface CreateTicketInput {
  typeKey: string;
  guild: Guild;
  openerUserId: string;
}

export interface CreateTicketResult {
  ticket: Ticket;
  channel: TextChannel;
}

export class TicketService {
  /**
   * Open a new ticket. Allocates the next number, creates the Discord text
   * channel under the configured Tickets category with type-specific permission
   * overwrites, posts the greeting + Claim/Close action row, optionally spawns
   * a private staff-notes thread, and inserts the ticket + opened event rows.
   *
   * Caller is responsible for replying to the user's interaction (since this
   * function may be called outside an interaction context, e.g. from a script).
   */
  static async create(input: CreateTicketInput): Promise<CreateTicketResult> {
    const { typeKey, guild, openerUserId } = input;

    const type = getTicketType(typeKey);
    if (!type) {
      throw new Error(`[tickets/service] unknown ticket type '${typeKey}'`);
    }
    if (!type.isActive) {
      throw new Error(`[tickets/service] ticket type '${typeKey}' is inactive`);
    }

    const categoryId = getTicketsCategoryId(guild.id);
    if (!categoryId) {
      throw new Error(
        `[tickets/service] no Tickets category configured for guild ${guild.id} ` +
          `(set TICKETS_CATEGORY_ID env var or add a guild_config entry)`
      );
    }

    // Allocate number first (transactional). Even if subsequent steps fail, the
    // counter has advanced — this is intentional, we'd rather skip a number
    // than risk a duplicate.
    const number = allocateNextNumber(type.numCounterKey);
    const channelName = formatChannelName(type.channelNameTemplate, number, null);

    const overwrites = buildTicketOverwrites(guild, type.permTemplate, openerUserId);

    const channel = (await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites,
      reason: `Ticket opened by ${openerUserId} (type=${type.key})`,
    })) as TextChannel;

    const ticketId = randomUUID();
    const openedAt = Math.floor(Date.now() / 1000);

    insertTicketStmt.run({
      id: ticketId,
      type_key: type.key,
      number,
      channel_id: channel.id,
      staff_thread_id: null,
      guild_id: guild.id,
      opener_user_id: openerUserId,
      opened_at: openedAt,
    });

    insertEventStmt.run(
      ticketId,
      "opened",
      openerUserId,
      JSON.stringify({ typeKey: type.key, number, channelId: channel.id })
    );

    // Post greeting message: opener mention + role mentions on plain content,
    // type body in embed below, claim/close action row.
    const pingMentions = [`<@${openerUserId}>`, ...type.pingRoleIds.map((id) => `<@&${id}>`)].join(" ");
    const embed = buildGreetingEmbed({
      type,
      ticketId,
      ticketNumber: number,
      openedAt: new Date(openedAt * 1000),
    });
    const actionRow = buildGreetingActionRow(ticketId, false);

    await channel.send({
      content: pingMentions,
      embeds: [embed],
      components: [actionRow],
      allowedMentions: {
        users: [openerUserId],
        roles: type.pingRoleIds,
      },
    });

    // Spawn staff-only private thread if the type wants one.
    // GOTCHA: message.startThread() can only create public threads. For a
    // private thread we go through channel.threads.create() instead.
    if (type.hasStaffThread) {
      try {
        const thread = await channel.threads.create({
          name: `Staff notes — ${channelName}`,
          autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
          type: ChannelType.PrivateThread,
          invitable: false,
          reason: `Ticket ${type.key}-${number} staff notes thread`,
        });
        setStaffThreadStmt.run(thread.id, ticketId);

        // Add staff role members (Community Ambassador / Mod Team, per type).
        // Private threads need explicit membership; matches modmail pattern.
        for (const roleId of type.permTemplate.roles.map((r) => r.id)) {
          try {
            const role = await guild.roles.fetch(roleId);
            if (!role) continue;
            for (const [memberId] of role.members) {
              try {
                await thread.members.add(memberId);
              } catch (err) {
                logger.debug(
                  { err, threadId: thread.id, memberId },
                  "[tickets/service] failed to add member to staff thread (non-fatal)"
                );
              }
            }
          } catch (err) {
            logger.warn(
              { err, threadId: thread.id, roleId },
              "[tickets/service] failed to populate staff thread for role"
            );
          }
        }
      } catch (err) {
        logger.error(
          { err, ticketId, channelId: channel.id },
          "[tickets/service] failed to spawn staff thread (ticket still open without thread)"
        );
      }
    }

    logger.info(
      {
        ticketId,
        typeKey: type.key,
        number,
        channelId: channel.id,
        openerUserId,
      },
      "[tickets/service] ticket opened"
    );

    const row = db
      .prepare(`SELECT * FROM ticket WHERE id = ?`)
      .get(ticketId) as TicketRow;

    return { ticket: rowToTicket(row), channel };
  }

  /**
   * Look up a ticket by its Discord channel ID. Returns null if the channel
   * isn't tracked (legacy Ticket Tool channels, or unrelated channels).
   */
  static findByChannelId(channelId: string): Ticket | null {
    const row = db
      .prepare(`SELECT * FROM ticket WHERE channel_id = ?`)
      .get(channelId) as TicketRow | undefined;
    return row ? rowToTicket(row) : null;
  }

  /** Look up a ticket by its UUID. */
  static findById(ticketId: string): Ticket | null {
    const row = db
      .prepare(`SELECT * FROM ticket WHERE id = ?`)
      .get(ticketId) as TicketRow | undefined;
    return row ? rowToTicket(row) : null;
  }
}
