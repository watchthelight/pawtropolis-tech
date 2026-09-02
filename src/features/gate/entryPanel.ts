/**
 * Pawtropolis Tech -- src/features/gate/entryPanel.ts
 * WHAT: Gate entry panel — builds the Verify embed/button payload, detects
 *       existing gate messages, and posts/refreshes the pinned panel.
 * WHY: Extracted from gate.ts (#00011) to shrink the module and isolate the
 *      panel-management concern from the interaction flow.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  EmbedBuilder,
  PermissionsBitField,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../../lib/logger.js";
import { getConfig, type GuildConfig } from "../../lib/config.js";
import type { CmdCtx } from "../../lib/cmdWrap.js";
import { getQuestions as getQuestionsShared } from "./questions.js";
import { BRAND_COLOR, GATE_ENTRY_FOOTER, GATE_ENTRY_FOOTER_MATCHES } from "./constants.js";

// A path attachment is re-read from disk by discord.js on every upload; the banner is
// posted with every verify thread, so read it once per process.
const bannerCache = new Map<string, Buffer>();
function bannerBuffer(bannerPath: string): Buffer {
  const abs = path.resolve(bannerPath);
  let buf = bannerCache.get(abs);
  if (!buf) {
    buf = fs.readFileSync(abs);
    bannerCache.set(abs, buf);
  }
  return buf;
}

export type EnsureGateEntryResult = {
  created: boolean;
  edited: boolean;
  pinned: boolean;
  channelId?: string;
  messageId?: string;
  reason?: string;
};

type GateEntryPayload = {
  embeds: Array<EmbedBuilder>;
  components: Array<ActionRowBuilder<ButtonBuilder>>;
  files: Array<AttachmentBuilder>;
};

type GateEntryContent = {
  title: string;
  description: string;
  buttonLabel: string;
  bannerPath: string;
  bannerName: string;
};

type GateEntryContentOptions = {
  guildName: string;
  config?: GuildConfig | null;
};

function resolveGateEntryContent(options: GateEntryContentOptions): GateEntryContent {
  const { guildName, config } = options;
  const questionCount = config?.guild_id
    ? getQuestionsShared(config.guild_id).length
    : 5;
  return {
    title: `Welcome to ${guildName}`,
    description:
      `Before you enjoy your stay, you must go through our verification system which you can start by clicking **Verify** and answering ${questionCount} simple question${questionCount === 1 ? "" : "s"}.`,
    buttonLabel: "Verify",
    bannerPath: "./assets/banner.webp",
    bannerName: "banner.webp",
  };
}

export function buildGateEntryPayload(options: {
  guild: Guild;
  config?: GuildConfig | null;
}): GateEntryPayload {
  const { guild } = options;
  const content = resolveGateEntryContent({ guildName: guild.name, config: options.config });

  const embed = new EmbedBuilder()
    .setTitle(content.title)
    .setDescription(content.description)
    .setColor(BRAND_COLOR)
    .setFooter({ text: GATE_ENTRY_FOOTER });

  // Use guild icon as author + thumbnail
  const iconUrl = typeof guild.iconURL === "function" ? guild.iconURL({ size: 128 }) : null;
  if (iconUrl) {
    embed.setAuthor({ name: guild.name, iconURL: iconUrl });
    embed.setThumbnail(iconUrl);
  }

  // Use guild banner if available, otherwise fall back to local asset
  const files: AttachmentBuilder[] = [];
  const guildBanner = guild.bannerURL({ size: 1024 });
  if (guildBanner) {
    embed.setImage(guildBanner);
  } else {
    const banner = new AttachmentBuilder(bannerBuffer(content.bannerPath)).setName(
      content.bannerName
    );
    embed.setImage(`attachment://${content.bannerName}`);
    files.push(banner);
  }

  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("v1:start")
        .setLabel(content.buttonLabel)
        .setStyle(ButtonStyle.Success)
    ),
  ];

  return { embeds: [embed], components, files };
}

/*
 * These two functions (messageHasStartButton + messageHasGateFooter) together
 * identify "our" gate messages. We check both because:
 * 1. Other bots might have "v1:start" buttons (unlikely but possible)
 * 2. Our own non-gate messages might have similar structures
 * Belt and suspenders. The footer is the stronger signal.
 */
function messageHasStartButton(message: Message) {
  return message.components.some((row) => {
    if (!("components" in row)) return false;
    return row.components?.some(
      (component: any) =>
        component.type === ComponentType.Button && component.customId === "v1:start"
    );
  });
}

function messageHasGateFooter(message: Message) {
  return message.embeds.some((embed) => {
    const footer = embed.footer?.text ?? null;
    return footer ? GATE_ENTRY_FOOTER_MATCHES.has(footer) : false;
  });
}

function isGateEntryCandidate(message: Message, botId: string | null) {
  if (botId && message.author?.id !== botId) return false;
  return messageHasStartButton(message) && messageHasGateFooter(message);
}

/**
 * Find existing gate entry message to edit rather than create duplicates.
 * Search order: pinned messages first (preferred location), then recent 50 messages.
 *
 * Why 50? It's a reasonable balance between finding orphaned gate entries and
 * API efficiency. If someone unpins the gate message but doesn't delete it,
 * we'll still find it in recent history.
 *
 * Returns null if no gate entry found - caller will create a new one.
 */
async function findExistingGateEntry(channel: GuildTextBasedChannel, botId: string | null) {
  // discord.js 14.24.x fetchPins() returns { items: Array<{ pinnedTimestamp, pinnedAt, message }>, hasMore }.
  // `items` is a plain Array — iterate directly. Do NOT call .values() on it.
  const pinned = await channel.messages.fetchPins().catch(() => null);
  const items = (pinned as { items?: Array<{ message?: Message }> } | null)?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const msg = item?.message;
      if (msg && isGateEntryCandidate(msg, botId)) return msg;
    }
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    for (const candidate of recent.values()) {
      if (isGateEntryCandidate(candidate, botId)) return candidate;
    }
  }

  return null;
}

/**
 * ensureGateEntryStartup
 * WHAT: Startup-friendly variant that handles bot-identity changes (new Discord application).
 * WHY: After a bot application swap, the existing pinned gate panel is owned by the old bot.
 *      Discord won't route the Verify button click to the new bot, so applicants get nothing.
 *      refreshGateEntry filters by current botId and silently no-ops; ensureGateEntry needs a
 *      CmdCtx. This function bridges the gap: scans the gate channel for any gate-shaped
 *      message regardless of author, deletes foreign-bot ones, then ensures the current bot
 *      has its own pinned panel.
 * IDEMPOTENT: safe to call on every startup. Edits in place if current bot already owns one.
 */
export async function ensureGateEntryStartup(
  client: Client,
  guildId: string
): Promise<{ deletedForeign: number; posted: boolean; edited: boolean; reason?: string }> {
  const result: { deletedForeign: number; posted: boolean; edited: boolean; reason?: string } = {
    deletedForeign: 0,
    posted: false,
    edited: false,
  };

  const cfg = getConfig(guildId);
  if (!cfg?.gate_channel_id) {
    result.reason = "gate channel not configured";
    return result;
  }

  let channel: GuildTextBasedChannel | null = null;
  try {
    const fetched = await client.channels.fetch(cfg.gate_channel_id);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch (err) {
    logger.warn({ err, guildId, channelId: cfg.gate_channel_id }, "[gate-startup] Failed to fetch gate channel");
    result.reason = "channel fetch failed";
    return result;
  }
  if (!channel) {
    result.reason = "channel unavailable";
    return result;
  }

  const botId = client.user?.id ?? null;
  if (!botId) {
    result.reason = "bot user not ready";
    return result;
  }

  const me =
    channel.guild.members.me ??
    (await channel.guild.members.fetch(botId).catch(() => null));
  if (!me) {
    result.reason = "bot member missing in guild";
    return result;
  }

  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) {
    result.reason = "missing ViewChannel";
    return result;
  }
  const hasSend = perms.has(PermissionsBitField.Flags.SendMessages);
  const hasManage = perms.has(PermissionsBitField.Flags.ManageMessages);

  // Scan pinned + recent for ANY gate-entry-shaped message regardless of author.
  // NOTE: discord.js v14.26 fetchPins() returns { items: Array<MessagePin>, hasMore }
  // where MessagePin = { message, pinnedAt, pinnedTimestamp }. `items` is a plain
  // array of pin entries, NOT a Collection of Message. Iterate it and use the
  // inner `message`, matching findExistingGateEntry above.
  const pinned = await channel.messages.fetchPins().catch(() => null);
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const candidates = new Map<string, Message>();
  if (pinned) {
    const items = (pinned as { items?: ReadonlyArray<{ message?: Message }> }).items;
    if (Array.isArray(items)) {
      for (const it of items) {
        const m = it?.message;
        if (m) candidates.set(m.id, m);
      }
    }
  }
  if (recent) for (const m of recent.values()) candidates.set(m.id, m);

  let currentBotMessage: Message | null = null;
  for (const m of candidates.values()) {
    // Defensive: messageHasStartButton/messageHasGateFooter call .some() on m.components
    // and m.embeds, both of which can be undefined for system messages, partial messages,
    // or messages of types we don't care about. Skip those before the candidate test.
    if (!Array.isArray(m.components) || !Array.isArray(m.embeds)) continue;
    if (!messageHasStartButton(m) || !messageHasGateFooter(m)) continue;
    if (m.author?.id === botId) {
      // Keep the most recent current-bot message; if multiple, edit one and delete the rest
      if (!currentBotMessage || m.createdTimestamp > currentBotMessage.createdTimestamp) {
        if (currentBotMessage && hasManage) {
          await currentBotMessage.delete().catch(() => {});
        }
        currentBotMessage = m;
      } else if (hasManage) {
        await m.delete().catch(() => {});
      }
    } else {
      // Foreign-bot gate panel — delete it (requires ManageMessages, which the bot needs anyway)
      try {
        await m.delete();
        result.deletedForeign++;
        logger.info(
          { guildId, messageId: m.id, foreignAuthorId: m.author?.id },
          "[gate-startup] deleted foreign-bot gate panel"
        );
      } catch (err) {
        logger.warn(
          { err, guildId, messageId: m.id, foreignAuthorId: m.author?.id },
          "[gate-startup] failed to delete foreign gate panel (need ManageMessages)"
        );
      }
    }
  }

  if (!hasSend) {
    result.reason = "missing SendMessages";
    return result;
  }

  const payload = buildGateEntryPayload({ guild: channel.guild, config: cfg });

  // Edit current bot's existing message in place if present, else send fresh
  if (currentBotMessage) {
    try {
      await currentBotMessage.edit({
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
        attachments: [],
      });
      result.edited = true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 10008) {
        // Message vanished between fetch and edit; fall through to fresh send
        currentBotMessage = null;
      } else {
        logger.warn({ err, guildId, messageId: currentBotMessage.id }, "[gate-startup] edit failed; will repost");
        currentBotMessage = null;
      }
    }
  }

  if (!currentBotMessage) {
    try {
      const sent = await channel.send(payload);
      result.posted = true;
      if (hasManage) {
        try {
          await sent.pin();
        } catch (err) {
          logger.warn({ err, guildId, messageId: sent.id }, "[gate-startup] failed to pin new gate panel");
        }
      }
    } catch (err) {
      logger.error({ err, guildId, channelId: channel.id }, "[gate-startup] failed to post fresh gate panel");
      result.reason = "post failed";
      return result;
    }
  }

  return result;
}

/**
 * Lightweight gate entry refresh — usable from event handlers without a CmdCtx.
 * Finds and edits the existing gate entry message in place.
 */
export async function refreshGateEntry(client: Client, guildId: string): Promise<void> {
  const cfg = getConfig(guildId);
  if (!cfg?.gate_channel_id) return;

  let channel: GuildTextBasedChannel | null = null;
  try {
    const fetched = await client.channels.fetch(cfg.gate_channel_id);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch { return; }
  if (!channel) return;

  const botId = client.user?.id ?? null;
  const existing = await findExistingGateEntry(channel, botId);
  if (!existing) return;

  const payload = buildGateEntryPayload({ guild: channel.guild, config: cfg });
  try {
    await existing.edit({
      embeds: payload.embeds,
      components: payload.components,
      files: payload.files,
      attachments: [],
    });
    logger.info({ guildId, messageId: existing.id }, "[gate] Auto-refreshed gate entry embed");
  } catch (err) {
    logger.warn({ err, guildId, messageId: existing.id }, "[gate] Failed to auto-refresh gate entry");
  }
}

function logPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  logger.info({
    evt: "gate_entry_step",
    traceId: ctx.traceId,
    phase,
    ...extras,
  });
}

function markSkippedPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  ctx.step(phase);
  logPhase(ctx, phase, { skipped: true, ...extras });
}

/**
 * ensureGateEntry
 * WHAT: Ensures there is a pinned Gate Entry message with a Start button in the configured gate channel.
 * WHY: Applicants need a stable entry point; we refresh/edit/pin instead of duplicating.
 * PARAMS:
 *  - ctx: CommandContext for logging/tracing.
 *  - guildId: Target guild id.
 * RETURNS: EnsureGateEntryResult describing what happened (created/edited/pinned).
 * THROWS: Propagates errors; callers typically log and continue.
 * LINKS:
 *  - Guild text channels API: https://discord.js.org/#/docs/discord.js/main/class/GuildTextBasedChannel
 * PITFALLS:
 *  - Requires SendMessages/ManageMessages to pin; fail-soft when missing permissions.
 */
export async function ensureGateEntry(
  ctx: CmdCtx,
  guildId: string
): Promise<EnsureGateEntryResult> {
  const result: EnsureGateEntryResult = { created: false, edited: false, pinned: false };

  ctx.step("load_config");
  const cfg = getConfig(guildId);
  logPhase(ctx, "load_config", { guildId, hasGateChannel: Boolean(cfg?.gate_channel_id) });
  if (!cfg?.gate_channel_id) {
    markSkippedPhase(ctx, "open_channel", { guildId, reason: "gate channel not configured" });
    markSkippedPhase(ctx, "find_existing", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "gate channel not configured" });
    result.reason = "gate channel not configured";
    return result;
  }

  let channel: GuildTextBasedChannel | null = null;
  ctx.step("open_channel");
  try {
    const fetched = await ctx.interaction.client.channels.fetch(cfg.gate_channel_id);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch (err) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!channel) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      reason: "channel unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "channel unavailable" });
    result.reason = "gate channel unavailable";
    return result;
  }

  result.channelId = channel.id;

  const botId = ctx.interaction.client.user?.id ?? null;
  const me =
    channel.guild.members.me ??
    (botId ? await channel.guild.members.fetch(botId).catch(() => null) : null);
  if (!me) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "bot member missing",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "bot member missing" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "bot member missing" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "bot member missing" });
    result.reason = "bot member missing";
    return result;
  }

  const perms = channel.permissionsFor(me);
  if (!perms) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "permissions unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "permissions unavailable" });
    result.reason = "unable to resolve permissions";
    return result;
  }

  const hasView = perms.has(PermissionsBitField.Flags.ViewChannel);
  const hasSend = perms.has(PermissionsBitField.Flags.SendMessages);
  const hasManage = perms.has(PermissionsBitField.Flags.ManageMessages);
  // Permissions check philosophy: fail-soft and explain what’s missing.
  // Docs: https://discord.com/developers/docs/topics/permissions

  logPhase(ctx, "open_channel", {
    guildId,
    channelId: channel.id,
    hasView,
    hasSend,
    hasManageMessages: hasManage,
  });

  if (!hasView) {
    markSkippedPhase(ctx, "find_existing", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "missing ViewChannel" });
    result.reason = "missing ViewChannel";
    return result;
  }

  ctx.step("find_existing");
  const existing = await findExistingGateEntry(channel, botId);
  if (existing) {
    result.messageId = existing.id;
  }
  logPhase(ctx, "find_existing", {
    channelId: channel.id,
    messageId: existing?.id ?? null,
  });

  if (!hasSend) {
    markSkippedPhase(ctx, "send_or_edit", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      reason: `missing SendMessages in #${channel.name}`,
    });
    markSkippedPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      hasManageMessages: hasManage,
      reason: `missing SendMessages in #${channel.name}`,
    });
    result.reason = `missing SendMessages in #${channel.name}`;
    return result;
  }

  ctx.step("send_or_edit");
  let message: Message | null = existing ?? null;
  let created = false;
  let edited = false;

  if (message) {
    const editPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    try {
      await message.edit({
        embeds: editPayload.embeds,
        components: editPayload.components,
        files: editPayload.files,
        attachments: [],
      });
      edited = true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 10008) {
        message = null;
      } else {
        throw err;
      }
    }
  }

  if (!message) {
    // Fresh send - this happens on first setup or if the old message was deleted
    const createPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    const sent = await channel.send(createPayload);
    message = sent;
    created = true;
  }

  result.messageId = message.id;
  result.created = created;
  result.edited = edited;
  logger.info(
    {
      channelId: channel.id,
      messageId: message.id,
      created,
      edited,
    },
    "[gate] entry posted"
  );
  logPhase(ctx, "send_or_edit", {
    channelId: channel.id,
    messageId: message.id,
    created,
    edited,
  });

  ctx.step("maybe_pin");
  if (!hasManage) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: false,
      reason: "missing ManageMessages",
    });
    result.reason = "missing ManageMessages";
    return result;
  }

  try {
    if (!message.pinned) {
      await message.pin();
    }
    const pinnedResponse = await channel.messages.fetchPins();
    // discord.js v14.26 fetchPins() returns { hasMore, items: readonly MessagePin[] } -
    // `items` is a plain Array (no .has()). Match the array shape used by
    // findExistingGateEntry elsewhere in this file.
    const pinnedItems = (pinnedResponse as unknown as { items?: ReadonlyArray<{ message?: { id: string } }> }).items;
    const pinnedMatch = Array.isArray(pinnedItems)
      ? pinnedItems.some((it) => it?.message?.id === message.id)
      : false;
    result.pinned = pinnedMatch;
    if (!pinnedMatch) {
      result.reason = "pin verification failed";
    }
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      pinned: pinnedMatch,
    });
    return result;
  } catch (err) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
