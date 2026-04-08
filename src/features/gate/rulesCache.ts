/**
 * Pawtropolis Tech — src/features/gate/rulesCache.ts
 * WHAT: Per-guild lazy cache of the unverified-rules channel content. The
 *       per-user verify thread feature (threadGate.ts) replicates these
 *       messages into each new joiner's private verify thread so they read
 *       the same rules they used to see in the public lobby.
 * WHY:  Avoid hammering Discord's API on every join (a 10-join spike would be
 *       10× message-fetch otherwise). The cache is invalidated by
 *       messageCreate / messageUpdate / messageDelete listeners in src/index.ts
 *       whenever the source channel changes, with a 10-minute TTL safety net.
 *
 * SAFETY: Read-only on Discord; never modifies channels or messages.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChannelType,
  type APIEmbed,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { logger } from "../../lib/logger.js";

/**
 * Minimal representation of a message we can re-post into a thread. Discord
 * components (buttons, dropdowns) are intentionally NOT replicated — they
 * would not function in the new thread because the original interaction
 * context is gone.
 */
export interface ReplicableMessage {
  content: string;
  embeds: APIEmbed[];
  /**
   * Inline attachment URLs. Discord's CDN URLs are signed and may eventually
   * expire, but they remain valid for hours and are stable enough for the
   * thread lifetime (auto-archived in 1 hour). For longer durability we'd need
   * to re-upload via AttachmentBuilder.from(url) — deferred to V2.
   */
  attachmentUrls: string[];
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes safety net
const MAX_REPLICATED_MESSAGES = 50; // hard cap on rules thread length

interface CacheEntry {
  channelId: string;
  messages: ReplicableMessage[];
  cachedAt: number;
}

// Keyed by guildId — multiple guilds can configure different rules channels.
const cache = new Map<string, CacheEntry>();

/**
 * Invalidate the cache for a guild. Called by event listeners in src/index.ts
 * when a message in the rules channel is created, edited, or deleted.
 */
export function invalidateRulesCache(guildId: string): void {
  if (cache.delete(guildId)) {
    logger.debug({ guildId }, "[rulesCache] invalidated");
  }
}

/**
 * Invalidate ALL guild caches. Used by tests / hot-reload only.
 */
export function clearAllRulesCache(): void {
  cache.clear();
}

/**
 * Convert a discord.js Message into a minimal ReplicableMessage. Strips
 * components, member mentions (to avoid pinging staff when the rules content
 * mentions someone), and large attachments.
 */
function toReplicable(msg: Message): ReplicableMessage {
  const embeds: APIEmbed[] = [];
  for (const e of msg.embeds) {
    try {
      embeds.push(e.toJSON() as APIEmbed);
    } catch {
      /* skip embeds we can't serialize */
    }
  }
  const attachmentUrls: string[] = [];
  for (const a of msg.attachments.values()) {
    if (typeof a.url === "string") attachmentUrls.push(a.url);
  }
  return {
    content: msg.content ?? "",
    embeds,
    attachmentUrls,
  };
}

/**
 * Fetch all messages from a channel, paginated, capped at MAX_REPLICATED_MESSAGES.
 * Returns oldest-first order.
 */
async function fetchAllChannelMessages(
  channel: GuildTextBasedChannel,
  cap: number
): Promise<Message[]> {
  const out: Message[] = [];
  let before: string | undefined = undefined;
  while (out.length < cap) {
    const remaining = cap - out.length;
    const limit = Math.min(100, remaining);
    // Explicit type annotation: TypeScript can't infer through the loop variable
    // reassignment otherwise.
    const page: Awaited<ReturnType<typeof channel.messages.fetch>> =
      await channel.messages.fetch({ limit, before });
    if (page.size === 0) break;
    for (const m of page.values()) out.push(m as Message);
    if (page.size < limit) break;
    // Discord returns newest-first; the oldest in the batch is the cursor for next page.
    const oldest: Message | undefined = page.last() as Message | undefined;
    if (!oldest) break;
    before = oldest.id;
  }
  // We accumulated newest-first across pages; reverse to get oldest-first.
  return out.reverse();
}

/**
 * Get the replicated rules messages for a guild. Lazy-fetch + cache. Pass the
 * actual rules channel ID — typically loaded from
 * `guild_config.unverified_rules_channel_id`.
 *
 * Returns an empty array if the channel can't be fetched or is empty (caller
 * should treat that as "no rules to replicate" and continue without them).
 */
export async function getUnverifiedRules(
  client: Client,
  guildId: string,
  channelId: string
): Promise<ReplicableMessage[]> {
  const existing = cache.get(guildId);
  if (
    existing &&
    existing.channelId === channelId &&
    Date.now() - existing.cachedAt < CACHE_TTL_MS
  ) {
    return existing.messages;
  }

  let channel: GuildTextBasedChannel | null = null;
  try {
    const fetched = await client.channels.fetch(channelId);
    if (
      fetched &&
      fetched.isTextBased() &&
      !fetched.isDMBased() &&
      fetched.type !== ChannelType.GuildVoice &&
      fetched.type !== ChannelType.GuildStageVoice
    ) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch (err) {
    logger.warn({ err, guildId, channelId }, "[rulesCache] failed to fetch rules channel");
    return [];
  }
  if (!channel) {
    logger.warn({ guildId, channelId }, "[rulesCache] rules channel not text-based");
    return [];
  }

  let raw: Message[] = [];
  try {
    raw = await fetchAllChannelMessages(channel, MAX_REPLICATED_MESSAGES);
  } catch (err) {
    logger.warn({ err, guildId, channelId }, "[rulesCache] failed to fetch rules messages");
    return [];
  }

  const messages = raw.map(toReplicable);
  cache.set(guildId, { channelId, messages, cachedAt: Date.now() });
  logger.info(
    { guildId, channelId, messageCount: messages.length },
    "[rulesCache] populated"
  );
  return messages;
}

/**
 * Helper for callers that want to know if a given channelId is the cached
 * rules channel for a guild — useful for the messageCreate listener filter.
 */
export function getCachedRulesChannelId(guildId: string): string | null {
  return cache.get(guildId)?.channelId ?? null;
}
