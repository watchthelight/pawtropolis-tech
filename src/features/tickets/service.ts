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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ChannelType,
  ThreadAutoArchiveDuration,
  EmbedBuilder,
  type Guild,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { notifyDashboard } from "../../web/notifyDashboard.js";
import { getTicketsCategoryId } from "./config.js";
import { allocateNextNumber } from "./counters.js";
import { buildTicketOverwrites } from "./permissions.js";
import { getTicketType } from "./registry.js";
import {
  buildGreetingActionRow,
  buildGreetingEmbed,
  formatChannelName,
  resolveMemberIdentity,
} from "./rendering.js";
import type { Ticket, TicketEventType, TicketRow } from "./types.js";

// Statements are lazy-prepared on first call rather than at module import.
// Eager prepare requires the `ticket` / `ticket_event` tables (migration 067)
// to exist before this module loads, which breaks any test setup or fresh DB
// where that migration has not run yet. Lazy prepare keeps the module
// importable even when the tables are absent — call sites still throw a
// clear SqliteError on first use if the migration is missing.
type Stmt = ReturnType<typeof db.prepare<unknown[]>>;
let cachedInsertTicketStmt: Stmt | null = null;
let cachedInsertEventStmt: Stmt | null = null;
let cachedSetStaffThreadStmt: Stmt | null = null;
let cachedSetGreetingMessageStmt: Stmt | null = null;
let cachedSetClaimedStmt: Stmt | null = null;
let cachedSetUnclaimedStmt: Stmt | null = null;
let cachedSetClosedStmt: Stmt | null = null;

function getInsertTicketStmt() {
  if (!cachedInsertTicketStmt) {
    cachedInsertTicketStmt = db.prepare(
      `INSERT INTO ticket (
         id, type_key, number, channel_id, staff_thread_id, greeting_message_id,
         guild_id, opener_user_id, claimed_by_user_id, status, close_reason,
         closed_by_user_id, archive_path, legacy_source,
         opened_at, claimed_at, closed_at
       ) VALUES (
         @id, @type_key, @number, @channel_id, @staff_thread_id, NULL,
         @guild_id, @opener_user_id, NULL, 'open', NULL, NULL, NULL, NULL,
         @opened_at, NULL, NULL
       )`
    );
  }
  return cachedInsertTicketStmt;
}

function getInsertEventStmt() {
  if (!cachedInsertEventStmt) {
    cachedInsertEventStmt = db.prepare(
      `INSERT INTO ticket_event (ticket_id, event_type, actor_user_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, unixepoch())`
    );
  }
  return cachedInsertEventStmt;
}

function getSetStaffThreadStmt() {
  if (!cachedSetStaffThreadStmt) {
    cachedSetStaffThreadStmt = db.prepare(
      `UPDATE ticket SET staff_thread_id = ? WHERE id = ?`
    );
  }
  return cachedSetStaffThreadStmt;
}

function getSetGreetingMessageStmt() {
  if (!cachedSetGreetingMessageStmt) {
    cachedSetGreetingMessageStmt = db.prepare(
      `UPDATE ticket SET greeting_message_id = ? WHERE id = ?`
    );
  }
  return cachedSetGreetingMessageStmt;
}

function getSetClaimedStmt() {
  if (!cachedSetClaimedStmt) {
    cachedSetClaimedStmt = db.prepare(
      `UPDATE ticket SET claimed_by_user_id = ?, claimed_at = unixepoch() WHERE id = ?`
    );
  }
  return cachedSetClaimedStmt;
}

function getSetUnclaimedStmt() {
  if (!cachedSetUnclaimedStmt) {
    cachedSetUnclaimedStmt = db.prepare(
      `UPDATE ticket SET claimed_by_user_id = NULL, claimed_at = NULL WHERE id = ?`
    );
  }
  return cachedSetUnclaimedStmt;
}

function getSetClosedStmt() {
  if (!cachedSetClosedStmt) {
    cachedSetClosedStmt = db.prepare(
      `UPDATE ticket SET status = 'closed', close_reason = ?, closed_by_user_id = ?,
                         closed_at = unixepoch(), archive_path = ?
       WHERE id = ?`
    );
  }
  return cachedSetClosedStmt;
}

/**
 * Maps an internal ticket_event type to the SSE event name surfaced to the
 * dashboard. Some internal events (artist-assigned, type-set) use a hyphen for
 * the row's event_type but underscore for SSE; we keep the SSE names aligned
 * with the SSEEventType union in web/src/lib/types/events.ts.
 */
const SSE_NAME_BY_EVENT: Record<string, string> = {
  opened: "ticket:opened",
  claimed: "ticket:claimed",
  unclaimed: "ticket:unclaimed",
  closed: "ticket:closed",
  reassigned: "ticket:reassigned",
  renamed: "ticket:renamed",
  "type-set": "ticket:type_set",
  "artist-assigned": "ticket:artist_assigned",
  // 'archived' is internal-only: the dashboard derives archive state from
  // ticket.archive_path rather than a separate SSE event.
};

function emitEvent(
  ticketId: string,
  type: TicketEventType,
  actorUserId: string | null,
  payload?: Record<string, unknown>
): void {
  getInsertEventStmt().run(ticketId, type, actorUserId, payload ? JSON.stringify(payload) : null);

  // Fire-and-forget SSE push for live dashboard updates. Always include the
  // ticket's typeKey so subscribers can apply tier-specific filters.
  const sseName = SSE_NAME_BY_EVENT[type];
  if (sseName) {
    const ticketRow = db
      .prepare(`SELECT type_key FROM ticket WHERE id = ?`)
      .get(ticketId) as { type_key: string } | undefined;
    notifyDashboard(sseName, {
      ticketId,
      typeKey: ticketRow?.type_key ?? null,
      ...(payload ?? {}),
    });
  }
}

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

    try {
      getInsertTicketStmt().run({
        id: ticketId,
        type_key: type.key,
        number,
        channel_id: channel.id,
        staff_thread_id: null,
        guild_id: guild.id,
        opener_user_id: openerUserId,
        opened_at: openedAt,
      });
    } catch (insertErr) {
      // The channel exists but the tracking row does not. Delete the channel so
      // we do not leave a permanent orphan that nothing can find/close.
      await channel.delete("Ticket DB insert failed; rolling back orphan channel").catch((delErr) => {
        logger.error(
          { err: delErr, ticketId, channelId: channel.id },
          "[tickets/service] failed to delete orphan channel after insert failure"
        );
      });
      throw insertErr;
    }

    emitEvent(ticketId, "opened", openerUserId, {
      typeKey: type.key,
      number,
      channelId: channel.id,
    });

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

    const greeting = await channel.send({
      content: pingMentions,
      embeds: [embed],
      components: [actionRow],
      allowedMentions: {
        users: [openerUserId],
        roles: type.pingRoleIds,
      },
    });
    getSetGreetingMessageStmt().run(greeting.id, ticketId);

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
        getSetStaffThreadStmt().run(thread.id, ticketId);

        // Add staff role members (Community Ambassador / Mod Team, per type).
        // Private threads need explicit membership; matches modmail pattern. One pass
        // over the member cache instead of role.members per role (each of those filters
        // the whole cache), and one add per distinct member.
        const staffRoleIds = new Set(type.permTemplate.roles.map((r) => r.id));
        const staffMemberIds = new Set<string>();
        for (const member of guild.members.cache.values()) {
          for (const roleId of member.roles.cache.keys()) {
            if (staffRoleIds.has(roleId)) {
              staffMemberIds.add(member.id);
              break;
            }
          }
        }
        for (const memberId of staffMemberIds) {
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

  /**
   * Mark the ticket claimed by the actor; update DB, emit event, and edit the
   * greeting embed in place — append a "Claimed by" field, swap Claim → Unclaim.
   * If the greeting message can't be found, the DB state still updates and we
   * post a small follow-up message instead.
   */
  static async claim(ticketId: string, claimerUserId: string, guild: Guild): Promise<void> {
    const ticket = TicketService.findById(ticketId);
    if (!ticket) throw new Error(`[tickets/service] ticket ${ticketId} not found`);
    if (ticket.status === "closed") {
      throw new Error(`[tickets/service] cannot claim a closed ticket`);
    }
    if (ticket.claimedByUserId === claimerUserId) {
      // Idempotent: already held — no-op.
      return;
    }

    getSetClaimedStmt().run(claimerUserId, ticketId);
    emitEvent(ticketId, "claimed", claimerUserId, {
      previousClaimer: ticket.claimedByUserId,
    });

    await TicketService.refreshGreetingMessage(ticket, guild, claimerUserId);
  }

  /** Drop the claim. Used when a staff member needs to hand off without closing. */
  static async unclaim(ticketId: string, actorUserId: string, guild: Guild): Promise<void> {
    const ticket = TicketService.findById(ticketId);
    if (!ticket) throw new Error(`[tickets/service] ticket ${ticketId} not found`);
    if (ticket.status === "closed") {
      throw new Error(`[tickets/service] cannot unclaim a closed ticket`);
    }
    if (ticket.claimedByUserId === null) {
      return;
    }
    const previousClaimer = ticket.claimedByUserId;
    getSetUnclaimedStmt().run(ticketId);
    emitEvent(ticketId, "unclaimed", actorUserId, { previousClaimer });
    await TicketService.refreshGreetingMessage(ticket, guild, null);
  }

  /**
   * Re-render the greeting embed with current claim state and edit the existing
   * message. Best-effort — failures log + return without throwing so the caller's
   * state-mutation is not undone.
   */
  private static async refreshGreetingMessage(
    ticket: Ticket,
    guild: Guild,
    claimerUserId: string | null
  ): Promise<void> {
    if (!ticket.greetingMessageId) return;
    try {
      const channel = (await guild.channels.fetch(ticket.channelId)) as TextChannel | null;
      if (!channel || channel.type !== ChannelType.GuildText) return;
      const message = await channel.messages.fetch(ticket.greetingMessageId);
      const type = getTicketType(ticket.typeKey);
      if (!type) return;
      const embed = buildGreetingEmbed({
        type,
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        openedAt: new Date(ticket.openedAt * 1000),
        claimedByUserId: claimerUserId,
      });
      const actionRow = buildGreetingActionRow(ticket.id, claimerUserId !== null);
      await message.edit({ embeds: [embed], components: [actionRow] });
    } catch (err) {
      logger.warn(
        { err, ticketId: ticket.id },
        "[tickets/service] failed to refresh greeting message — DB state still updated"
      );
    }
  }

  /**
   * Close the ticket: update DB, revoke opener SendMessages, lock + archive
   * staff thread, prepend `closed-` to channel name, render archive JSON, post
   * a final "Closed" embed.
   */
  static async close(
    ticketId: string,
    opts: { closedByUserId: string; reason: string; guild: Guild }
  ): Promise<void> {
    const { closedByUserId, reason, guild } = opts;
    const ticket = TicketService.findById(ticketId);
    if (!ticket) throw new Error(`[tickets/service] ticket ${ticketId} not found`);
    if (ticket.status === "closed") {
      // Idempotent: already closed.
      return;
    }

    // Apply the closed state to the DB first, then snapshot the terminal ticket
    // into the archive. writeArchive serializes the ticket object verbatim, so it
    // must reflect status='closed' / closeReason / closedAt rather than the stale
    // open snapshot returned by findById.
    const closedAt = Math.floor(Date.now() / 1000);
    const closedTicket: Ticket = {
      ...ticket,
      status: "closed",
      closeReason: reason,
      closedByUserId,
      closedAt,
    };
    const archivePath = await TicketService.writeArchive(closedTicket);
    getSetClosedStmt().run(reason, closedByUserId, archivePath, ticketId);
    emitEvent(ticketId, "closed", closedByUserId, { reason, archivePath });

    let channel: TextChannel | null = null;
    try {
      channel = (await guild.channels.fetch(ticket.channelId)) as TextChannel | null;
    } catch (err) {
      logger.warn({ err, ticketId }, "[tickets/service] could not fetch channel during close");
    }

    // Revoke opener SendMessages so the channel becomes read-only for them.
    if (channel) {
      try {
        await channel.permissionOverwrites.edit(ticket.openerUserId, {
          SendMessages: false,
        });
      } catch (err) {
        logger.warn(
          { err, ticketId, openerUserId: ticket.openerUserId },
          "[tickets/service] failed to revoke opener SendMessages on close"
        );
      }
    }

    // Lock + archive the staff thread.
    if (ticket.staffThreadId) {
      try {
        const thread = (await guild.channels.fetch(ticket.staffThreadId)) as ThreadChannel | null;
        if (thread && thread.isThread()) {
          await thread.setLocked(true).catch(() => {});
          await thread.setArchived(true).catch(() => {});
        }
      } catch (err) {
        logger.warn(
          { err, ticketId, staffThreadId: ticket.staffThreadId },
          "[tickets/service] failed to lock/archive staff thread"
        );
      }
    }

    // Rename channel to `closed-<original-truncated>`. Total <= 100 chars.
    if (channel) {
      const newName = `closed-${channel.name}`.slice(0, 100);
      try {
        if (channel.name !== newName) await channel.setName(newName);
      } catch (err) {
        logger.warn(
          { err, ticketId, oldName: channel.name },
          "[tickets/service] failed to rename channel on close"
        );
      }

      // Final embed in channel so latecomers see closure context.
      try {
        const finalEmbed = new EmbedBuilder()
          .setTitle("Ticket closed")
          .setColor(0x4f545c)
          .setDescription(`Closed by <@${closedByUserId}>`)
          .addFields({ name: "Reason", value: reason.slice(0, 1024) || "(no reason given)" });
        await channel.send({ embeds: [finalEmbed], allowedMentions: { parse: [] } });
      } catch (err) {
        logger.warn({ err, ticketId }, "[tickets/service] failed to post final close embed");
      }
    }

    emitEvent(ticketId, "archived", null, { archivePath });
    logger.info(
      { ticketId, closedByUserId, archivePath },
      "[tickets/service] ticket closed"
    );
  }

  /**
   * Snapshot the ticket + transcript + events to a JSON file under
   * data/ticket-archives/. Returns the relative path stored on the ticket row.
   * Transcript rows may be empty until P6 listeners ship — that's expected and
   * the archive still records meta + events.
   */
  private static async writeArchive(ticket: Ticket): Promise<string> {
    const archiveDir = join(process.cwd(), "data", "ticket-archives");
    mkdirSync(archiveDir, { recursive: true });
    const filename = `${ticket.id}.json`;
    const fullPath = join(archiveDir, filename);

    const messages = db
      .prepare(`SELECT * FROM ticket_message WHERE ticket_id = ? ORDER BY created_at`)
      .all(ticket.id);
    const events = db
      .prepare(`SELECT * FROM ticket_event WHERE ticket_id = ? ORDER BY created_at`)
      .all(ticket.id);
    const attachments = db
      .prepare(`SELECT * FROM ticket_attachment WHERE ticket_id = ? ORDER BY created_at`)
      .all(ticket.id);

    const payload = {
      schema_version: 1,
      ticket,
      messages,
      events,
      attachments,
      archived_at: Math.floor(Date.now() / 1000),
    };
    writeFileSync(fullPath, JSON.stringify(payload, null, 2), "utf8");
    return `ticket-archives/${filename}`;
  }

  /**
   * Resolve the artist currently working a given ticket. Primary source: the
   * latest non-completed art_job row linked via ticket_id. Fallback: the latest
   * artist_assignment_log row scoped to the ticket's channel_id (covers tickets
   * created before art_job.ticket_id was wired). Returns null if no signal.
   */
  static getCurrentArtistId(ticketId: string): string | null {
    const ticket = TicketService.findById(ticketId);
    if (!ticket) return null;

    const fromJob = db
      .prepare(
        `SELECT artist_id FROM art_job
         WHERE ticket_id = ?
           AND status NOT IN ('done', 'cancelled', 'reassigned')
         ORDER BY assigned_at DESC LIMIT 1`
      )
      .get(ticketId) as { artist_id: string } | undefined;
    if (fromJob) return fromJob.artist_id;

    const fromLog = db
      .prepare(
        `SELECT artist_id FROM artist_assignment_log
         WHERE channel_id = ?
         ORDER BY assigned_at DESC LIMIT 1`
      )
      .get(ticket.channelId) as { artist_id: string } | undefined;
    return fromLog?.artist_id ?? null;
  }

  /**
   * Rename the ticket's channel to reflect the current artist. For art-redeem
   * tickets, transforms `art-NNNN` → `art-NNNN-<artistnick>`. For other types
   * with a `{artist?}` token, same. Idempotent: no-op when name already matches.
   */
  static async renameForArtist(
    ticketId: string,
    artistUserId: string | null,
    guild: Guild
  ): Promise<void> {
    const ticket = TicketService.findById(ticketId);
    if (!ticket) throw new Error(`[tickets/service] ticket ${ticketId} not found`);
    const type = getTicketType(ticket.typeKey);
    if (!type) return;
    if (!type.channelNameTemplate.includes("{artist?}")) return; // type doesn't carry artist in name

    let identity: string | null = null;
    if (artistUserId) {
      try {
        const member = await guild.members.fetch(artistUserId);
        identity = resolveMemberIdentity(member);
      } catch (err) {
        logger.warn(
          { err, artistUserId, ticketId },
          "[tickets/service] could not resolve artist member for rename"
        );
      }
    }

    const desired = formatChannelName(type.channelNameTemplate, ticket.number, identity);
    let channel: TextChannel | null = null;
    try {
      channel = (await guild.channels.fetch(ticket.channelId)) as TextChannel | null;
    } catch (err) {
      logger.warn({ err, ticketId }, "[tickets/service] could not fetch channel for rename");
      return;
    }
    if (!channel || channel.type !== ChannelType.GuildText) return;
    if (channel.name === desired) return;

    const previous = channel.name;
    try {
      await channel.setName(desired);
      emitEvent(ticketId, "renamed", null, { from: previous, to: desired });
      logger.info(
        { ticketId, from: previous, to: desired },
        "[tickets/service] channel renamed"
      );
    } catch (err) {
      logger.warn(
        { err, ticketId, desired },
        "[tickets/service] failed to setName (likely Discord rate limit)"
      );
    }
  }

  /**
   * Manually swap the artist on an art-style ticket. Revokes the prior artist's
   * permission overwrite, grants the new one, closes the prior open art_job
   * row (status='reassigned' with notes), inserts a new art_job, renames the
   * channel, and emits a `reassigned` event. Does NOT touch the queue
   * rotation — manual reassignment is a corrective action, not a rotational one.
   */
  static async reassignArtist(
    ticketId: string,
    opts: {
      fromArtistId: string | null;
      toArtistId: string;
      actorUserId: string;
      guild: Guild;
    }
  ): Promise<void> {
    const { fromArtistId, toArtistId, actorUserId, guild } = opts;
    if (fromArtistId === toArtistId) {
      throw new Error("[tickets/service] cannot reassign to the same artist");
    }

    const ticket = TicketService.findById(ticketId);
    if (!ticket) throw new Error(`[tickets/service] ticket ${ticketId} not found`);
    if (ticket.status === "closed") {
      throw new Error(`[tickets/service] cannot reassign a closed ticket`);
    }
    if (ticket.legacySource !== null) {
      throw new Error(
        `[tickets/service] cannot reassign on legacy ticket (legacy_source=${ticket.legacySource})`
      );
    }

    let channel: TextChannel | null = null;
    try {
      channel = (await guild.channels.fetch(ticket.channelId)) as TextChannel | null;
    } catch {
      // fall through; perms can't be set without channel
    }

    if (channel) {
      // Revoke prior artist
      if (fromArtistId) {
        try {
          await channel.permissionOverwrites.delete(
            fromArtistId,
            `Reassigned away by ${actorUserId}`
          );
        } catch (err) {
          logger.warn(
            { err, ticketId, fromArtistId },
            "[tickets/service] failed to remove old artist overwrite"
          );
        }
      }
      // Grant new artist
      try {
        await channel.permissionOverwrites.edit(toArtistId, {
          ViewChannel: true,
          SendMessages: true,
          EmbedLinks: true,
          AttachFiles: true,
          ReadMessageHistory: true,
        });
      } catch (err) {
        logger.warn(
          { err, ticketId, toArtistId },
          "[tickets/service] failed to grant new artist overwrite"
        );
      }
    }

    // Close prior art_job rows for this ticket, mark reassigned, drop a note.
    db.prepare(
      `UPDATE art_job
         SET status = 'cancelled',
             updated_at = datetime('now'),
             notes = COALESCE(notes || ' | ', '') || ?
       WHERE ticket_id = ? AND status NOT IN ('done', 'cancelled', 'reassigned')`
    ).run(`Reassigned by ${actorUserId} at ${new Date().toISOString()}`, ticketId);

    // Note: insertion of the new art_job row is the responsibility of /assignticket
    // since it knows the ticket_type/recipient. service.ts only tracks Discord state.

    emitEvent(ticketId, "reassigned", actorUserId, {
      fromArtistId,
      toArtistId,
    });

    await TicketService.renameForArtist(ticketId, toArtistId, guild);

    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle("Artist reassigned")
        .setColor(0xfeb800)
        .setDescription(
          `${fromArtistId ? `From <@${fromArtistId}> ` : ""}to <@${toArtistId}>\nReassigned by <@${actorUserId}>`
        );
      try {
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      } catch (err) {
        logger.warn({ err, ticketId }, "[tickets/service] failed to post reassign embed");
      }
    }
  }
}
