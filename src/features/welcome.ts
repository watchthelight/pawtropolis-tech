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
import { readFileSync } from "node:fs";
import { logger } from "../lib/logger.js";
import type { GuildConfig } from "../lib/config.js";
import { sleep } from "../lib/retry.js";
import { renderWelcomeTemplate } from "./review/welcome.js";

const BANNER_PATH = "./assets/banner.webp";
const BANNER_NAME = "banner.webp";
type BannerFile = { attachment: Buffer; name: string };
let bannerBuffer: Buffer | null = null;

// discord.js re-reads a path attachment from disk on every send; every welcome DM
// carries the banner, so it is read once per process.
function bannerFile(): BannerFile {
  bannerBuffer ??= readFileSync(BANNER_PATH);
  return { attachment: bannerBuffer, name: BANNER_NAME };
}

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
): { embed: APIEmbed; files: BannerFile[] } {
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

  return { embed, files: [bannerFile()] };
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
  guildId: string,
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
          { err, guildId, channelId: channel.id, attempt },
          "[welcome] transient error on channel line, retrying..."
        );
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      logger.error(
        { err, guildId, channelId: channel.id, attempt },
        "[welcome] failed to send welcome channel line"
      );
      throw err;
    }
  }
  throw lastError;
}

// ============================================================================
// Grouped, debounced welcome announcer
// ============================================================================
// The rich card is DMed per user; the main channel only gets a short, grouped
// shout-out ("Please welcome @a, and @b!"). To avoid clogging the channel when
// several people are approved in a burst, we buffer approvals per guild and
// flush one combined line after a short quiet period (or once the group is
// large enough / the max window elapses).

interface AnnounceBuffer {
  channel: GuildTextBasedChannel;
  guildId: string;
  rolePingId: string | null;
  members: Map<string, GuildMember>;
  timer: ReturnType<typeof setTimeout> | null;
  firstAt: number;
}

const announceBuffers = new Map<string, AnnounceBuffer>();
const ANNOUNCE_DEBOUNCE_MS = 10_000; // wait this long for more approvals
const ANNOUNCE_MAX_WINDOW_MS = 60_000; // never delay the first person past this
const ANNOUNCE_MAX_GROUP = 20; // flush immediately once this many are buffered

/**
 * formatWelcomeAnnounce
 * WHAT: Builds the grouped welcome line, English-style comma/"and" joined.
 * Examples: "Please welcome @a!", "Please welcome @a, and @b!",
 *           "Please welcome @a, @b, and @c!". Role ping (if any) is prepended.
 */
export function formatWelcomeAnnounce(mentions: string[], rolePingId: string | null): string {
  let names: string;
  if (mentions.length <= 1) {
    names = mentions[0] ?? "";
  } else if (mentions.length === 2) {
    names = `${mentions[0]}, and ${mentions[1]}`;
  } else {
    names = `${mentions.slice(0, -1).join(", ")}, and ${mentions[mentions.length - 1]}`;
  }
  const line = `Please welcome ${names}!`;
  return rolePingId ? `<@&${rolePingId}> ${line}` : line;
}

function scheduleAnnounceFlush(buf: AnnounceBuffer): void {
  if (buf.timer) clearTimeout(buf.timer);
  const elapsed = Date.now() - buf.firstAt;
  const wait = Math.max(0, Math.min(ANNOUNCE_DEBOUNCE_MS, ANNOUNCE_MAX_WINDOW_MS - elapsed));
  buf.timer = setTimeout(() => {
    void flushWelcomeAnnounce(buf.guildId);
  }, wait);
  // Don't keep the event loop alive just for a welcome flush.
  if (typeof buf.timer === "object" && buf.timer && "unref" in buf.timer) {
    (buf.timer as { unref: () => void }).unref();
  }
}

/**
 * enqueueWelcomeAnnounce
 * WHAT: Adds a member to the guild's pending welcome group and (re)arms the
 *       debounce timer. Flushes immediately once the group hits the cap.
 */
function enqueueWelcomeAnnounce(
  channel: GuildTextBasedChannel,
  guild: Guild,
  member: GuildMember,
  rolePingId: string | null
): void {
  let buf = announceBuffers.get(guild.id);
  if (!buf) {
    buf = {
      channel,
      guildId: guild.id,
      rolePingId,
      members: new Map(),
      timer: null,
      firstAt: Date.now(),
    };
    announceBuffers.set(guild.id, buf);
  } else {
    // Keep the freshest channel/role reference in case config changed.
    buf.channel = channel;
    buf.rolePingId = rolePingId;
  }
  buf.members.set(member.id, member);

  if (buf.members.size >= ANNOUNCE_MAX_GROUP) {
    void flushWelcomeAnnounce(guild.id);
  } else {
    scheduleAnnounceFlush(buf);
  }
}

/**
 * flushWelcomeAnnounce
 * WHAT: Posts the grouped welcome line for a guild now, clearing the buffer.
 * WHY: Exported so the manual /welcomebatch send path and graceful shutdown can
 *      force an immediate flush instead of waiting on the debounce timer.
 */
export async function flushWelcomeAnnounce(guildId: string): Promise<void> {
  const buf = announceBuffers.get(guildId);
  if (!buf) return;
  if (buf.timer) clearTimeout(buf.timer);
  announceBuffers.delete(guildId);

  const members = [...buf.members.values()];
  if (members.length === 0) return;

  const mentions = members.map((m) => `<@${m.id}>`);
  const content = formatWelcomeAnnounce(mentions, buf.rolePingId);
  const allowedMentions = {
    users: members.map((m) => m.id),
    roles: buf.rolePingId ? [buf.rolePingId] : [],
  };

  try {
    const message = await sendChannelLine(buf.channel, guildId, content, allowedMentions);
    logger.info(
      {
        guildId,
        channelId: buf.channel.id,
        messageId: message.id,
        userCount: members.length,
        userIds: members.map((m) => m.id),
      },
      "[welcome] posted grouped welcome line"
    );
  } catch (err) {
    logger.error(
      { err, guildId, channelId: buf.channel.id, userCount: members.length },
      "[welcome] failed to post grouped welcome line"
    );
  }
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
 * WHAT: DMs the rich welcome embed to the user, then adds them to the guild's
 *       grouped channel shout-out (debounced; no embed in the channel).
 * WHY: Members get the full card privately; the main channel only gets a short,
 *      grouped "Please welcome @a, and @b!" line so welcomes don't clog chat.
 * PARAMS:
 *  - guild: Discord Guild instance
 *  - user: GuildMember being welcomed
 *  - config: GuildConfig with channel/role IDs
 *  - memberCount: Current server member count
 * THROWS: Error if channel is missing/invalid or bot lacks permissions (so the
 *         caller can surface a misconfiguration note at approval time).
 */
export async function postWelcomeCard(opts: {
  guild: Guild;
  user: GuildMember;
  config: GuildConfig;
  memberCount: number;
}): Promise<void> {
  const { guild, user, config, memberCount } = opts;

  // Validate the channel up front so misconfig surfaces now, even though the
  // actual channel line is posted later by the grouped announcer.
  const channel = await fetchGeneralChannel(guild, config);

  // DM the rich embed (best-effort; fails soft if the user has DMs closed).
  await deliverWelcomeDm(guild, user, config, memberCount);

  // Buffer the member for the grouped, debounced channel shout-out.
  enqueueWelcomeAnnounce(channel, guild, user, config.welcome_ping_role_id ?? null);
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
}): Promise<void> {
  const { guild, users, config, memberCount } = opts;

  if (users.length === 0) throw new Error("postBatchWelcomeCard: empty users");

  const channel = await fetchGeneralChannel(guild, config);

  // Cap at 20 to match the grouped-line cap and keep the line readable.
  const cappedUsers = users.slice(0, ANNOUNCE_MAX_GROUP);

  // DM the rich embed to each user individually (best-effort, in parallel).
  await Promise.all(cappedUsers.map((u) => deliverWelcomeDm(guild, u, config, memberCount)));

  // Buffer all of them, then flush immediately — this is an explicit "send now"
  // (e.g. /welcomebatch send), so we don't wait on the debounce timer.
  for (const u of cappedUsers) {
    enqueueWelcomeAnnounce(channel, guild, u, config.welcome_ping_role_id ?? null);
  }
  await flushWelcomeAnnounce(guild.id);
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

