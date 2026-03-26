/**
 * Pawtropolis Tech -- src/features/modmail/dashboardBridge.ts
 * WHAT: Interaction-free modmail operations for the web dashboard.
 * WHY: The existing modmail functions are tightly coupled to Discord interactions.
 *      This bridge provides thin wrappers that accept {client, guild} instead
 *      of interaction objects, enabling dashboard-initiated modmail actions.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChannelType,
  EmbedBuilder,
  type Client,
  type Guild,
  type ThreadChannel,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { getConfig } from "../../lib/config.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import { buildStaffToUserEmbed } from "./routing.js";
import { insertModmailMessage, getTicketById, getOpenTicketByUser, closeTicket, reopenTicket } from "./tickets.js";
import { appendTranscript, flushTranscript } from "./transcript.js";
import { addOpenThread, removeOpenThread } from "./threadState.js";
import { openPublicModmailThreadFor } from "./threadOpen.js";

// ===== Send Message =====

/**
 * dashboardSendMessage
 * WHAT: Send a modmail message from dashboard (staff → user DM).
 * WHY: Allows moderators to send modmail messages without Discord client.
 */
export async function dashboardSendMessage(params: {
  client: Client;
  guild: Guild;
  staffUserId: string;
  ticketId: number;
  content: string;
}): Promise<{ success: boolean; error?: string }> {
  const { client, guild, staffUserId, ticketId, content } = params;

  const ticket = getTicketById(ticketId);
  if (!ticket) return { success: false, error: "Ticket not found" };
  if (ticket.status !== "open") return { success: false, error: "Ticket is not open" };
  if (!ticket.thread_id) return { success: false, error: "Ticket has no thread" };

  try {
    // Fetch target user
    const user = await client.users.fetch(ticket.user_id);

    // Build staff-to-user embed (privacy: shows server identity, not staff)
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Dashboard",
      staffAvatarUrl: null,
      content,
      guildName: guild.name,
      guildIconUrl: guild.iconURL({ size: 128 }),
    });

    // Send to user DM
    const dmMessage = await user.send({
      embeds: [embed],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });

    // Also post to the thread so other staff can see it
    let threadMessageId: string | undefined;
    try {
      const thread = await client.channels.fetch(ticket.thread_id);
      if (thread?.isThread()) {
        // Fetch staff member for display name
        let staffName = "Dashboard Staff";
        try {
          const member = await guild.members.fetch(staffUserId);
          staffName = member.displayName ?? member.user.globalName ?? member.user.username;
        } catch { /* best effort */ }

        const threadMsg = await (thread as ThreadChannel).send({
          content: `**[Dashboard — ${staffName}]** ${content}`,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        });
        threadMessageId = threadMsg.id;
      }
    } catch (err) {
      logger.warn({ err, ticketId, threadId: ticket.thread_id }, "[modmail:dashboard] failed to echo to thread");
    }

    // Record in DB (all named params must be present for better-sqlite3)
    insertModmailMessage({
      ticketId: ticket.id,
      direction: "to_user",
      threadMessageId,
      dmMessageId: dmMessage.id,
      replyToThreadMessageId: undefined,
      replyToDmMessageId: undefined,
      content,
    });

    appendTranscript(ticket.id, "STAFF", content);

    return { success: true };
  } catch (err) {
    logger.warn({ err, ticketId, staffUserId }, "[modmail:dashboard] failed to send message");
    captureException(err, { area: "modmail:dashboardSend", ticketId });
    return { success: false, error: "Failed to send message (user DMs may be closed)" };
  }
}

// ===== Open Thread =====

/**
 * dashboardOpenThread
 * WHAT: Open a new modmail thread from the dashboard.
 * WHY: Allows moderators to initiate modmail without being in Discord.
 */
export async function dashboardOpenThread(params: {
  client: Client;
  guild: Guild;
  staffUserId: string;
  targetUserId: string;
  appCode?: string;
}): Promise<{ success: boolean; error?: string; ticketId?: number; threadId?: string }> {
  const { client, guild, staffUserId, targetUserId, appCode } = params;

  // Check for existing open ticket
  const existing = getOpenTicketByUser(guild.id, targetUserId);
  if (existing) {
    return {
      success: false,
      error: `User already has an open modmail thread (ticket #${existing.id})`,
    };
  }

  // Get the review channel to create the thread in
  const cfg = getConfig(guild.id);
  const reviewChannelId = cfg?.review_channel_id;
  if (!reviewChannelId) {
    return { success: false, error: "Review channel not configured" };
  }

  try {
    const channel = await client.channels.fetch(reviewChannelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildForum)) {
      return { success: false, error: "Review channel is not a valid text/forum channel" };
    }

    // Get the staff member to mock the interaction
    const member = await guild.members.fetch(staffUserId);

    // Use the existing openPublicModmailThreadFor with a minimal interaction-like object
    // Since the function is tightly coupled, we construct a partial interaction
    const result = await openPublicModmailThreadFor({
      interaction: {
        guildId: guild.id,
        guild,
        client,
        channel,
        user: { id: staffUserId, tag: member.user.tag, username: member.user.username },
        member,
      } as any,
      userId: targetUserId,
      appCode,
    });

    if (!result.success) {
      return { success: false, error: result.message };
    }

    // Extract ticket info from the open ticket
    const ticket = getOpenTicketByUser(guild.id, targetUserId);

    return {
      success: true,
      ticketId: ticket?.id,
      threadId: ticket?.thread_id ?? undefined,
    };
  } catch (err) {
    logger.error({ err, targetUserId, staffUserId }, "[modmail:dashboard] failed to open thread");
    captureException(err, { area: "modmail:dashboardOpen", targetUserId });
    return { success: false, error: "Failed to open modmail thread" };
  }
}

// ===== Close Thread =====

/**
 * dashboardCloseThread
 * WHAT: Close an open modmail thread from the dashboard.
 * WHY: Allows moderators to close modmail without being in Discord.
 */
export async function dashboardCloseThread(params: {
  client: Client;
  guild: Guild;
  staffUserId: string;
  ticketId: number;
}): Promise<{ success: boolean; error?: string; logUrl?: string | null }> {
  const { client, guild, staffUserId, ticketId } = params;

  const ticket = getTicketById(ticketId);
  if (!ticket) return { success: false, error: "Ticket not found" };
  if (ticket.status === "closed") return { success: false, error: "Ticket is already closed" };

  try {
    // Close in DB and clean up guard table
    db.transaction(() => {
      closeTicket(ticket.id);
      db.prepare(`DELETE FROM open_modmail WHERE guild_id = ? AND applicant_id = ?`)
        .run(guild.id, ticket.user_id);
    })();

    // Remove from open threads set
    if (ticket.thread_id) {
      removeOpenThread(ticket.thread_id);
    }

    // Lock and archive thread
    if (ticket.thread_id) {
      try {
        const thread = await client.channels.fetch(ticket.thread_id);
        if (thread?.isThread()) {
          await (thread as ThreadChannel).setLocked(true);
          await (thread as ThreadChannel).setArchived(true);
        }
      } catch (err) {
        logger.warn({ err, ticketId, threadId: ticket.thread_id }, "[modmail:dashboard] failed to archive thread");
      }
    }

    // Notify applicant
    try {
      const user = await client.users.fetch(ticket.user_id);
      const closeEmbed = new EmbedBuilder()
        .setColor(0x64748b)
        .setTitle("Modmail Closed")
        .setDescription(`Your modmail thread for **${guild.name}** has been closed by staff.`);
      await user.send({ embeds: [closeEmbed] });
    } catch (err) {
      logger.warn({ err, ticketId, userId: ticket.user_id }, "[modmail:dashboard] failed to DM applicant on close");
    }

    // Flush transcript
    let logUrl: string | null = null;
    const result = await flushTranscript({
      client,
      ticketId: ticket.id,
      guildId: guild.id,
      userId: ticket.user_id,
      appCode: ticket.app_code,
    });

    if (result.messageId) {
      const cfg = getConfig(guild.id);
      const logChannelId = cfg?.modmail_log_channel_id ?? null;
      db.prepare(`UPDATE modmail_ticket SET log_channel_id = ?, log_message_id = ? WHERE id = ?`)
        .run(logChannelId, result.messageId, ticket.id);
      if (logChannelId) {
        logUrl = `https://discord.com/channels/${guild.id}/${logChannelId}/${result.messageId}`;
      }
    }

    // Refresh review card
    try {
      const { ensureReviewMessage } = await import("../review.js");
      const { findAppByShortCode } = await import("../appLookup.js");
      const app = ticket.app_code
        ? (findAppByShortCode(guild.id, ticket.app_code) as { id: string } | null)
        : null;
      if (app) await ensureReviewMessage(client, app.id);
    } catch (err) {
      logger.warn({ err, ticketId }, "[modmail:dashboard] failed to refresh card after close");
    }

    logger.info({ ticketId, staffUserId }, "[modmail:dashboard] thread closed");
    return { success: true, logUrl };
  } catch (err) {
    logger.error({ err, ticketId, staffUserId }, "[modmail:dashboard] failed to close thread");
    captureException(err, { area: "modmail:dashboardClose", ticketId });
    return { success: false, error: "Failed to close modmail thread" };
  }
}

// ===== Reopen Thread =====

/**
 * dashboardReopenThread
 * WHAT: Reopen a closed modmail thread from the dashboard.
 * WHY: Allows moderators to continue conversations without being in Discord.
 */
export async function dashboardReopenThread(params: {
  client: Client;
  guild: Guild;
  staffUserId: string;
  ticketId: number;
}): Promise<{ success: boolean; error?: string; threadId?: string }> {
  const { client, guild, staffUserId, ticketId } = params;

  const ticket = getTicketById(ticketId);
  if (!ticket) return { success: false, error: "Ticket not found" };
  if (ticket.status === "open") return { success: false, error: "Ticket is already open" };

  // Check if closed within 7 days
  const closedAt = ticket.closed_at ? new Date(ticket.closed_at).getTime() : 0;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (Date.now() - closedAt > sevenDays) {
    return { success: false, error: "Ticket closed more than 7 days ago — open a new thread instead" };
  }

  try {
    // Reopen in DB and restore guard table
    db.transaction(() => {
      reopenTicket(ticket.id);
      if (ticket.thread_id) {
        db.prepare(
          `INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
           VALUES (?, ?, ?, strftime('%s','now'))
           ON CONFLICT(guild_id, applicant_id) DO UPDATE SET thread_id=excluded.thread_id`
        ).run(guild.id, ticket.user_id, ticket.thread_id);
      }
    })();

    // Restore in-memory set
    if (ticket.thread_id) {
      addOpenThread(ticket.thread_id);
    }

    // Unlock and unarchive thread
    if (ticket.thread_id) {
      try {
        const thread = await client.channels.fetch(ticket.thread_id);
        if (thread?.isThread()) {
          await (thread as ThreadChannel).setArchived(false);
          await (thread as ThreadChannel).setLocked(false);
        }
      } catch (err) {
        logger.warn({ err, ticketId, threadId: ticket.thread_id }, "[modmail:dashboard] failed to unarchive thread");
      }
    }

    // Notify applicant
    try {
      const user = await client.users.fetch(ticket.user_id);
      const reopenEmbed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("Modmail Reopened")
        .setDescription(`Your modmail thread for **${guild.name}** has been reopened by staff.`);
      await user.send({ embeds: [reopenEmbed] });
    } catch (err) {
      logger.warn({ err, ticketId, userId: ticket.user_id }, "[modmail:dashboard] failed to DM applicant on reopen");
    }

    logger.info({ ticketId, staffUserId, threadId: ticket.thread_id }, "[modmail:dashboard] thread reopened");
    return { success: true, threadId: ticket.thread_id ?? undefined };
  } catch (err) {
    logger.error({ err, ticketId, staffUserId }, "[modmail:dashboard] failed to reopen thread");
    captureException(err, { area: "modmail:dashboardReopen", ticketId });
    return { success: false, error: "Failed to reopen modmail thread" };
  }
}
