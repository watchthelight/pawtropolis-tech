// SPDX-License-Identifier: LicenseRef-ANW-1.0
// Welcome card module: handles the rich embed posted when a new member is approved.
// Separated from review.ts to keep welcome logic self-contained and testable.
import {
  APIEmbed,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  Message,
  PermissionFlagsBits,
} from "discord.js";
import { logger } from "../lib/logger.js";
import type { GuildConfig } from "../lib/config.js";
import { sleep } from "../lib/retry.js";
import { renderWelcomeTemplate } from "./review/welcome.js";

const BANNER_FILE = { attachment: "./assets/banner.webp", name: "banner.webp" };

/**
 * buildWelcomeEmbed
 * WHAT: Constructs the rich welcome embed + banner attachment for a single user.
 * WHY: Shared by the DM delivery path for both solo and batch welcomes so the
 *      card stays identical regardless of how it was triggered.
 */
function buildWelcomeEmbed(
  guild: Guild,
  user: GuildMember,
  config: GuildConfig,
  memberCount: number
): { embed: APIEmbed; files: typeof BANNER_FILE[] } {
  // The first line ("greeting") is admin-controlled via config.welcome_template
  // when set. Token substitution lets legacy {applicant.mention}/{guild.name}
  // resolve; raw <@&id>/<#id> from the dashboard editor pass through Discord
  // as real role pings and channel chips. Bot still owns the structural bits
  // (member count, channel link list, signoff, footer).
  const trimmedTemplate =
    typeof config.welcome_template === "string" ? config.welcome_template.trim() : "";
  const greeting = trimmedTemplate.length > 0
    ? renderWelcomeTemplate({
        template: config.welcome_template,
        guildName: guild.name,
        applicant: {
          id: user.id,
          tag: user.user?.tag ?? user.user.username,
          display: user.displayName,
        },
      })
    : `👋 Welcome <@${user.id}>!`;

  const descriptionLines: string[] = [
    greeting,
    `This server now has **${memberCount.toLocaleString()} Users!**`,
  ];

  const infoChannelMention = config.info_channel_id ? `<#${config.info_channel_id}>` : null;
  const rulesChannelMention = config.rules_channel_id ? `<#${config.rules_channel_id}>` : null;
  if (infoChannelMention || rulesChannelMention) {
    descriptionLines.push("", "🔗 Be sure to check out:");
    if (infoChannelMention) descriptionLines.push(`• ${infoChannelMention}`);
    if (rulesChannelMention) descriptionLines.push(`• ${rulesChannelMention}`);
  }
  descriptionLines.push("", "✅ Enjoy your stay!", "", "_Bot by watchthelight._");

  const embed: APIEmbed = {
    color: 0x00c2ff, // This cyan matches the brand. Don't change it on a whim.
    author: {
      name: guild.name,
      icon_url: guild.iconURL({ size: 128 }) ?? undefined,
    },
    title: "Welcome to Pawtropolis 🐾",
    description: descriptionLines.join("\n"),
    thumbnail: { url: user.displayAvatarURL({ size: 128 }) },
    image: { url: "attachment://banner.webp" },
    footer: { text: "Pawtropolis Moderation Team" },
  };

  return { embed, files: [BANNER_FILE] };
}

/**
 * fetchGeneralChannel
 * WHAT: Resolves + permission-checks the configured general channel.
 * WHY: The one-line chat shout-out only needs ViewChannel + SendMessages now
 *      that the rich embed is delivered via DM, not posted in-channel.
 */
async function fetchGeneralChannel(guild: Guild, config: GuildConfig): Promise<GuildTextBasedChannel> {
  const channelId = config.general_channel_id;
  if (!channelId) {
    throw new Error("general channel not configured");
  }

  // GOTCHA: guild.channels.fetch() can return null even for valid IDs if the bot
  // was recently added or the cache is cold. The isTextBased() check is necessary
  // because Voice channels also have IDs that look identical to text channel IDs.
  let channel: GuildTextBasedChannel;
  try {
    const fetched = await guild.channels.fetch(channelId);
    if (!fetched || !fetched.isTextBased()) {
      throw new Error("general channel is not a valid text channel");
    }
    channel = fetched as GuildTextBasedChannel;
  } catch (err) {
    logger.warn({ err, guildId: guild.id, channelId }, "[welcome] failed to fetch general channel");
    throw new Error("failed to fetch general channel");
  }

  const me = guild.members.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    const missingPerms: string[] = [];
    if (!perms?.has(PermissionFlagsBits.ViewChannel)) missingPerms.push("ViewChannel");
    if (!perms?.has(PermissionFlagsBits.SendMessages)) missingPerms.push("SendMessages");
    if (missingPerms.length > 0) {
      logger.warn(
        { guildId: guild.id, channelId, missingPerms },
        "[welcome] missing permissions in general channel"
      );
      throw new Error(`missing permissions: ${missingPerms.join(", ")}`);
    }
  }

  return channel;
}

/**
 * sendChannelLine
 * WHAT: Posts a one-sentence, non-embed welcome line to the channel with pings.
 * WHY: The visible shout-out in main chat. Retries transient network errors.
 */
async function sendChannelLine(
  channel: GuildTextBasedChannel,
  guild: Guild,
  content: string,
  allowedMentions: { users: string[]; roles: string[] }
): Promise<Message> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 500;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await channel.send({ content, allowedMentions });
    } catch (err) {
      lastError = err;
      if (isTransientError(err) && attempt < MAX_RETRIES) {
        logger.warn(
          { err, guildId: guild.id, channelId: channel.id, attempt },
          "[welcome] transient error on channel line, retrying..."
        );
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      logger.error(
        { err, guildId: guild.id, channelId: channel.id, attempt },
        "[welcome] failed to send welcome channel line"
      );
      throw err;
    }
  }
  throw lastError;
}

/**
 * deliverWelcomeDm
 * WHAT: DMs the rich welcome embed (with banner) to a single user.
 * WHY: Per request, the embed is now a DM rather than an in-channel post.
 * NOTE: Best-effort. Users can disable DMs from server members; we fail-soft so
 *       the channel shout-out still goes out.
 * RETURNS: true if the DM was delivered.
 */
async function deliverWelcomeDm(
  guild: Guild,
  user: GuildMember,
  config: GuildConfig,
  memberCount: number
): Promise<boolean> {
  const { embed, files } = buildWelcomeEmbed(guild, user, config, memberCount);
  try {
    await user.send({ embeds: [embed], files });
    return true;
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id, userId: user.id },
      "[welcome] failed to DM welcome embed (user likely has DMs closed)"
    );
    return false;
  }
}

/**
 * postWelcomeCard
 * WHAT: DMs the rich welcome embed to the user and posts a one-sentence welcome
 *       line (non-embed) to the configured general channel with the welcome ping.
 * WHY: Members get the full card privately; the channel just gets a short, pinged
 *      shout-out so the welcome ping role is notified without channel clutter.
 * PARAMS:
 *  - guild: Discord Guild instance
 *  - user: GuildMember being welcomed
 *  - config: GuildConfig with channel/role IDs
 *  - memberCount: Current server member count
 * RETURNS: The posted channel Message, or throws on failure.
 * THROWS: Error if channel is missing/invalid or bot lacks permissions.
 */
export async function postWelcomeCard(opts: {
  guild: Guild;
  user: GuildMember;
  config: GuildConfig;
  memberCount: number;
}): Promise<Message> {
  const { guild, user, config, memberCount } = opts;

  const channel = await fetchGeneralChannel(guild, config);

  // DM the rich embed first (best-effort).
  const dmDelivered = await deliverWelcomeDm(guild, user, config, memberCount);

  // One-sentence channel shout-out with pings (user + optional welcome role).
  // The ping lives in content, not an embed: Discord only notifies on content mentions.
  const contentParts = [`<@${user.id}>`];
  if (config.welcome_ping_role_id) {
    contentParts.push(`<@&${config.welcome_ping_role_id}>`);
  }
  const content = `${contentParts.join(" ")} Welcome to **${guild.name}**! 🐾`;

  // allowedMentions is a security measure: even if content somehow contained
  // @everyone, Discord only pings the IDs we explicitly whitelist here.
  const allowedMentions = {
    users: [user.id],
    roles: config.welcome_ping_role_id ? [config.welcome_ping_role_id] : [],
  };

  const message = await sendChannelLine(channel, guild, content, allowedMentions);

  logger.info(
    { guildId: guild.id, channelId: channel.id, messageId: message.id, userId: user.id, dmDelivered },
    "[welcome] posted welcome (embed via DM, line in channel)"
  );

  return message;
}

/**
 * postBatchWelcomeCard
 * WHAT: Posts a single welcome card mentioning multiple newly-accepted users at once.
 * WHY: When several users get approved in a short window, batch their welcomes into one
 *      message to avoid spamming the general channel.
 */
export async function postBatchWelcomeCard(opts: {
  guild: Guild;
  users: GuildMember[];
  config: GuildConfig;
  memberCount: number;
}): Promise<Message> {
  const { guild, users, config, memberCount } = opts;

  if (users.length === 0) throw new Error("postBatchWelcomeCard: empty users");
  if (users.length === 1) {
    return postWelcomeCard({ guild, user: users[0]!, config, memberCount });
  }

  const channel = await fetchGeneralChannel(guild, config);

  // Discord allowedMentions caps role mentions but user mentions are bounded by message length.
  // We cap at 25 to keep the line readable and stay safely under any limits.
  const MAX_USERS_PER_CARD = 25;
  const cappedUsers = users.slice(0, MAX_USERS_PER_CARD);
  const userMentions = cappedUsers.map((u) => `<@${u.id}>`);

  // DM the rich embed to each user individually (best-effort, in parallel).
  const dmResults = await Promise.all(
    cappedUsers.map((u) => deliverWelcomeDm(guild, u, config, memberCount))
  );
  const dmDelivered = dmResults.filter(Boolean).length;

  // One-sentence channel shout-out mentioning everyone + optional welcome role.
  const contentParts = [...userMentions];
  if (config.welcome_ping_role_id) {
    contentParts.push(`<@&${config.welcome_ping_role_id}>`);
  }
  const content = `${contentParts.join(" ")} Welcome to **${guild.name}**! 🐾`;

  const allowedMentions = {
    users: cappedUsers.map((u) => u.id),
    roles: config.welcome_ping_role_id ? [config.welcome_ping_role_id] : [],
  };

  const message = await sendChannelLine(channel, guild, content, allowedMentions);

  logger.info(
    {
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      userCount: cappedUsers.length,
      userIds: cappedUsers.map((u) => u.id),
      dmDelivered,
    },
    "[welcome] posted batch welcome (embeds via DM, line in channel)"
  );

  return message;
}

/**
 * Checks if an error is a transient network error that should be retried.
 * Common transient errors from undici/Discord:
 * - SocketError: other side closed (UND_ERR_SOCKET)
 * - ConnectTimeoutError (UND_ERR_CONNECT_TIMEOUT)
 * - HeadersTimeoutError (UND_ERR_HEADERS_TIMEOUT)
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check for undici socket errors
  const code = (err as Error & { code?: string }).code;
  if (code?.startsWith("UND_ERR_")) return true;

  // Check for common transient error messages
  const msg = err.message.toLowerCase();
  return (
    msg.includes("other side closed") ||
    msg.includes("socket hang up") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused")
  );
}

