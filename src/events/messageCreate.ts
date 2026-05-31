/**
 * Pawtropolis Tech — src/events/messageCreate.ts
 * WHAT: messageCreate + threadCreate handlers. Routes modmail thread/DM
 *       messages, verify-thread answers, dad/skull modes, activity tracking,
 *       and forum-post notifications.
 * WHY: Extracted from index.ts (#00007) to keep the entrypoint a thin bootstrap.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type Client, ChannelType } from "discord.js";
import { logger } from "../lib/logger.js";
import { wrapEvent } from "../lib/eventWrap.js";
import { newTraceId } from "../lib/reqctx.js";
import { captureException } from "../lib/sentry.js";
import { db } from "../db/db.js";
import { forumPostNotify } from "./forumPostNotify.js";
import { getTicketByThread, routeThreadToDm, routeDmToThread } from "../features/modmail.js";
import type { ModmailTicket } from "../features/modmail/types.js";

export function registerMessageEvents(client: Client): void {
// Modmail message routing + first-message tracking (PR8)
client.on("messageCreate", wrapEvent("messageCreate", async (message) => {
  // begging Discord to send us valid messages
  // Ignore bot messages
  if (message.author.bot) return;

  // Invalidate the rules cache if this message is in a configured
  // unverified-rules channel — keeps the verify-thread rules replication
  // synced with staff edits in real time. The 10-min TTL on the cache is a
  // backstop, but explicit invalidation is faster.
  if (message.guildId) {
    try {
      const { getCachedRulesChannelId, invalidateRulesCache } = await import(
        "../features/gate/rulesCache.js"
      );
      if (getCachedRulesChannelId(message.guildId) === message.channelId) {
        invalidateRulesCache(message.guildId);
      }
    } catch {
      /* non-fatal */
    }
  }

  const traceId = newTraceId();

  try {
    // NOTE: Forum post notification moved to threadCreate event
    // See client.on('threadCreate', ...) handler below
    // This prevents duplicate pings for every message in a forum thread

    // Log message activity for heatmap (Migration 020)
    // WHAT: Tracks all server messages for /activity command heatmap visualization
    // WHY: Provides real-time data on message activity patterns
    // DOCS: See src/features/messageActivityLogger.ts
    if (message.guildId) {
      try {
        const { logMessage } = await import("../features/messageActivityLogger.js");
        logMessage(message);
      } catch (err) {
        logger.debug(
          { err, messageId: message.id, guildId: message.guildId },
          "[message_activity] failed to log message"
        );
      }

      // Art channel auto-ping: ping the relevant art role when someone posts
      try {
        const { artChannelPing } = await import("../events/artChannelPing.js");
        await artChannelPing(message);
      } catch (err) {
        logger.debug({ err, messageId: message.id }, "[artChannelPing] failed");
      }
    }

    // Track first message for Silent-Since-Join detection (PR8)
    // WHAT: Records first_message_at timestamp and evaluates threshold for flagging
    // WHY: Detects accounts that stay silent for N days before posting (entropy indicator)
    // DOCS: See src/features/activityTracker.ts
    if (message.guildId) {
      try {
        const { trackFirstMessage } = await import("../features/activityTracker.js");
        await trackFirstMessage(client, message);
      } catch (err) {
        logger.warn(
          { err, userId: message.author.id, guildId: message.guildId },
          "[activity] failed to track first message"
        );
      }
    }

    // Dad Mode: Respond to "I'm..." messages with dad jokes
    // WHAT: Playful feature that replies "Hi <name>, I'm dad" to messages like "I'm tired"
    // WHY: Adds personality and community engagement in guilds
    // HOW: Checks guild config for enabled state and odds, then triggers dad joke
    // DOCS: See src/listeners/messageDadMode.ts
    if (message.guildId && !message.webhookId) {
      try {
        const { execute: executeDadMode } = await import("../listeners/messageDadMode.js");
        await executeDadMode(message);
      } catch (err) {
        logger.debug({ err, messageId: message.id }, "[dadmode] handler failed");
      }
    }

    // Skull Mode: Random skull emoji reactions
    // WHAT: Randomly reacts to messages with a skull emoji based on configurable odds
    // WHY: Adds playful chaos and community engagement in guilds
    // HOW: Checks guild config for enabled state and odds, then reacts with skull
    // DOCS: See src/listeners/messageSkullMode.ts
    if (message.guildId && !message.webhookId) {
      try {
        const { execute: executeSkullMode } = await import("../listeners/messageSkullMode.js");
        await executeSkullMode(message);
      } catch (err) {
        logger.debug({ err, messageId: message.id }, "[skullmode] handler failed");
      }
    }

    // Check if message is in a modmail thread or per-user verify thread
    if (message.channel.isThread() && message.guildId) {
      // Modmail thread routing (existing)
      const ticket = getTicketByThread(message.channel.id);
      if (ticket && ticket.status === "open") {
        await routeThreadToDm(message, ticket, client);
        return;
      }
      // Per-user verify thread routing — if the message author is the same
      // user this thread belongs to AND they have an active verification
      // session, route the message to handleDmAnswer (which is channel-
      // agnostic and uses message.channel.send() for follow-up questions).
      try {
        const { getVerifyThreadByThreadId } = await import("../features/gate/threadGate.js");
        const verifyRow = getVerifyThreadByThreadId(message.channel.id);
        if (verifyRow && verifyRow.user_id === message.author.id) {
          const { hasActiveSession, handleDmAnswer } = await import(
            "../features/gate/dmVerification.js"
          );
          if (hasActiveSession(message.author.id)) {
            await handleDmAnswer(message);
            return;
          }
        }
      } catch (err) {
        logger.debug(
          { err, channelId: message.channel.id, userId: message.author.id },
          "[messageCreate] verify thread routing failed (non-fatal)"
        );
      }
    }

    // Check if message is a DM
    if (message.channel.type === ChannelType.DM) {
      // DM gate verification — check before modmail routing
      const { hasActiveSession, handleDmAnswer } = await import("../features/gate/dmVerification.js");
      if (hasActiveSession(message.author.id)) {
        await handleDmAnswer(message);
        return;
      }

      // what if we kissed in the DMs (modmail edition)
      // Find open ticket for this user across all guilds
      const tickets = db
        .prepare(
          `
        SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
        FROM modmail_ticket
        WHERE user_id = ? AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `
        )
        .all(message.author.id) as Array<ModmailTicket>;

      if (tickets.length > 0) {
        const ticket = tickets[0]!;
        await routeDmToThread(message, ticket, client);
        return;
      }
    }
  } catch (err) {
    logger.error({ err, traceId, messageId: message.id }, "[modmail] message routing failed");
    captureException(err, { area: "modmail:messageCreate", traceId });

    // Notify user their message wasn't delivered
    try {
      await message.reply({
        content: "Sorry, there was an issue delivering your message. Please try again or contact staff through another channel.",
      });
    } catch (replyErr) {
      logger.debug({ err: replyErr }, "[modmail] Failed to notify user of routing failure");
    }
  }
}));

// Forum post notification: alert moderators of new forum posts (threadCreate event)
// WHAT: Pings admin thread ONCE when a new forum thread (post) is created
// WHY: Ensure timely response to member feedback without duplicate pings for each message
// SAFETY: Uses allowedMentions, permission checks, and audit logging
// DOCS: See src/events/forumPostNotify.ts
// NOTE: This replaced the previous messageCreate approach which incorrectly pinged for every message
client.on("threadCreate", wrapEvent("threadCreate", async (thread) => {
  await forumPostNotify(thread);
}));
}
