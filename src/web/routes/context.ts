/**
 * Pawtropolis Tech -- src/web/routes/context.ts
 * WHAT: Shared per-request helpers for dashboard route modules — guild lookup,
 *       moderator identity caching, review-channel confirmation messages.
 * WHY: Extracted from dashboardApi.ts (#00008) so route groups in this dir can
 *      share the closures that used to live inside startDashboardApi.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client, Guild, TextChannel } from "discord.js";
import { getConfig } from "../../lib/config.js";
import { cacheUser } from "../../lib/userCache.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import { logger } from "../../lib/logger.js";

const GUILD_ID = process.env.GUILD_ID!;

export interface DashboardRouteContext {
  client: Client;
  getGuild(): Guild | undefined;
  cacheModerator(userId: string): Promise<void>;
  postReviewChannelMessage(appId: string, content: string, reviewMessageId?: string): Promise<void>;
}

export function createRouteContext(client: Client): DashboardRouteContext {
  // Helper to get guild
  function getGuild(): Guild | undefined {
    return client.guilds.cache.get(GUILD_ID);
  }

  /** Best-effort cache of moderator identity for dashboard display. */
  async function cacheModerator(userId: string): Promise<void> {
    try {
      const user = await client.users.fetch(userId);
      const guild = getGuild();
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      cacheUser(user, GUILD_ID, member);
    } catch { /* best-effort */ }
  }

  /** Post a confirmation message in the review channel, replying to the review card. */
  async function postReviewChannelMessage(appId: string, content: string, reviewMessageId?: string): Promise<void> {
    try {
      const cfg = getConfig(GUILD_ID);
      const channelId = cfg?.review_channel_id;
      if (!channelId) return;
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;
      await (channel as TextChannel).send({
        content,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
        ...(reviewMessageId ? { reply: { messageReference: reviewMessageId, failIfNotExists: false } } : {}),
      });
    } catch (err) {
      logger.warn({ err, appId }, "[dashboardApi] failed to post review channel message");
    }
  }

  return { client, getGuild, cacheModerator, postReviewChannelMessage };
}
